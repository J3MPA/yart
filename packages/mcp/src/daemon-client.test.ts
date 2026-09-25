import { realpathSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { TestRepo } from '@yart/daemon/test-repo'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DaemonClient } from './daemon-client.ts'

let repo: TestRepo
let fake: Server | null = null

beforeEach(() => {
  repo = new TestRepo()
  repo.write('a.txt', 'a\n')
  repo.commit('base')
})

afterEach(async () => {
  repo.dispose()
  if (fake !== null) await new Promise<void>((resolve) => fake?.close(() => resolve()))
  fake = null
})

/**
 * Stands in for a daemon from before one daemon served every repository: its
 * health check names the one repository it serves and carries no version.
 */
const oldDaemonServing = async (repo_path: string): Promise<number> => {
  fake = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/health') {
      response.end(JSON.stringify({ ok: true, repo_path }))
      return
    }
    response.end('[]')
  })
  await new Promise<void>((resolve) => fake?.listen(0, resolve))
  return (fake?.address() as AddressInfo).port
}

describe('an older daemon still running after an update', () => {
  it('is refused when it serves a different repository', async () => {
    const other = new TestRepo()
    try {
      const port = await oldDaemonServing(realpathSync(other.path))
      const client = new DaemonClient({ port, repo_path: repo.path, autostart: false })
      await expect(client.listReviews()).rejects.toThrow(/older yart/)
    } finally {
      other.dispose()
    }
  })

  it('is still used when it serves this same repository', async () => {
    const port = await oldDaemonServing(realpathSync(repo.path))
    const client = new DaemonClient({ port, repo_path: repo.path, autostart: false })
    await expect(client.listReviews()).resolves.toEqual([])
  })

  it('is still used from a directory inside the repository it serves', async () => {
    repo.write('deep/inside/file.txt', 'x\n')
    const port = await oldDaemonServing(realpathSync(repo.path))
    const client = new DaemonClient({
      port,
      repo_path: `${repo.path}/deep/inside`,
      autostart: false,
    })
    await expect(client.listReviews()).resolves.toEqual([])
  })
})
