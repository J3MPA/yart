import { readFileSync, statSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import type { Review } from '@yart/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOOK_MARKER, installHook, preCommit, uninstallHook } from './hook.ts'
import { createServer } from './server.ts'
import { TestRepo } from './test-repo.ts'

let repo: TestRepo
let http: ServerType
let port: number
let lines: string[]

beforeEach(async () => {
  repo = new TestRepo()
  repo.write('a.txt', 'alpha\nbeta\n')
  repo.commit('base')
  const app = createServer({ repo_path: repo.path })
  http = await new Promise<ServerType>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, () => resolve(server))
  })
  port = (http.address() as AddressInfo).port
  lines = []
})

afterEach(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()))
  repo.dispose()
})

const api = (path: string, init?: RequestInit) =>
  fetch(`http://localhost:${port}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
  })

const settle = (changes: Record<string, unknown>) =>
  api('/api/settings', { method: 'PATCH', body: JSON.stringify(changes) })

/** A reviewer command that gives a verdict through the API, as a real reviewer would. */
const reviewerThat = (round: Record<string, unknown>) =>
  `curl -s -X POST "http://localhost:${port}/api/reviews/$YART_REVIEW_ID/submit" ` +
  `-H 'content-type: application/json' ` +
  `-d '${JSON.stringify({ author: 'reviewer', author_name: 'test-reviewer', ...round })}' > /dev/null`

const stage = (content: string) => {
  repo.write('a.txt', content)
  repo.git('add', '-A')
}

const run = (timeout_ms = 10_000) =>
  preCommit({
    repo_path: repo.path,
    port,
    timeout_ms,
    poll_ms: 50,
    write: (line) => lines.push(line),
  })

const reviews = async () => (await (await api('/api/reviews')).json()) as Review[]

describe('installHook', () => {
  it('writes an executable hook that runs yart', async () => {
    const path = await installHook(repo.path)
    expect(readFileSync(path, 'utf8')).toContain('yart hook pre-commit')
    expect(statSync(path).mode & 0o111).not.toBe(0)
  })

  it('refuses to replace a hook that yart did not write', async () => {
    const path = join(repo.path, '.git', 'hooks', 'pre-commit')
    writeFileSync(path, '#!/bin/sh\necho mine\n')
    await expect(installHook(repo.path)).rejects.toThrow(/did not write/)
    expect(readFileSync(path, 'utf8')).toContain('echo mine')
  })

  it('uses the hooks directory that git is set to', async () => {
    repo.git('config', 'core.hooksPath', '.hooks')
    expect(await installHook(repo.path)).toBe(join(repo.path, '.hooks', 'pre-commit'))
  })
})

describe('uninstallHook', () => {
  it('removes the hook of yart, and leaves a different hook alone', async () => {
    await installHook(repo.path)
    expect(await uninstallHook(repo.path)).toBe(true)
    const path = join(repo.path, '.git', 'hooks', 'pre-commit')
    writeFileSync(path, '#!/bin/sh\necho mine\n')
    expect(await uninstallHook(repo.path)).toBe(false)
    expect(readFileSync(path, 'utf8')).not.toContain(HOOK_MARKER)
  })
})

describe('preCommit', () => {
  it('does nothing when no reviewer command is set', async () => {
    stage('alpha\nBETA\n')
    expect(await run()).toBe(0)
    expect(await reviews()).toHaveLength(0)
  })

  it('does nothing when nothing is staged', async () => {
    await settle({ reviewer_command: reviewerThat({ verdict: 'approved' }) })
    expect(await run()).toBe(0)
    expect(await reviews()).toHaveLength(0)
  })

  it('lets the commit continue when the reviewer approves', async () => {
    await settle({ reviewer_command: reviewerThat({ verdict: 'approved' }) })
    stage('alpha\nBETA\n')
    expect(await run()).toBe(0)
    expect(lines.join('\n')).toContain('approved')
  })

  it('stops the commit on a request for changes, and moves the same review on the next commit', async () => {
    await settle({
      reviewer_command: reviewerThat({
        verdict: 'changes_requested',
        threads: [{ path: 'a.txt', line: 2, body: 'shouting' }],
      }),
    })
    stage('alpha\nBETA\n')
    expect(await run()).toBe(1)
    expect(lines.join('\n')).toContain('a.txt:2  shouting')

    await settle({ reviewer_command: reviewerThat({ verdict: 'approved' }) })
    stage('alpha\nbeta two\n')
    expect(await run()).toBe(0)
    const [only] = await reviews()
    expect(await reviews()).toHaveLength(1)
    expect(only?.rounds).toHaveLength(2)
  })

  it('stops the commit when the reviewer command fails', async () => {
    await settle({ reviewer_command: 'exit 3' })
    stage('alpha\nBETA\n')
    expect(await run()).toBe(1)
    expect(lines.join('\n')).toContain('exit code 3')
  })

  it('stops the commit when no verdict comes in time', async () => {
    await settle({ reviewer_command: 'sleep 5' })
    stage('alpha\nBETA\n')
    expect(await run(300)).toBe(1)
    expect(lines.join('\n')).toContain('no verdict came')
  })

  it('stops the commit when the reviewer has no more rounds', async () => {
    await settle({
      ai_review_rounds: 1,
      reviewer_command: reviewerThat({ verdict: 'changes_requested' }),
    })
    stage('alpha\nBETA\n')
    expect(await run()).toBe(1)
    stage('alpha\nbeta two\n')
    expect(await run()).toBe(1)
    expect(lines.join('\n')).toContain('no more rounds')
  })
})
