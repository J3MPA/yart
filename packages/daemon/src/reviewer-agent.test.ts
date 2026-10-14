import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  installReviewerAgent,
  REVIEWER_AGENT,
  REVIEWER_FILE_NAME,
  uninstallReviewerAgent,
} from './reviewer-agent.ts'
import { TestRepo } from './test-repo.ts'

let repo: TestRepo

beforeEach(() => {
  repo = new TestRepo()
})

afterEach(() => {
  repo.dispose()
})

const agentPath = () => join(repo.path, '.claude', 'agents', REVIEWER_FILE_NAME)

describe('the reviewer subagent', () => {
  it('names itself and limits itself to reading and the reviewer tools', () => {
    const front = REVIEWER_AGENT.split('---')[1] ?? ''
    expect(front).toContain('name: yart-reviewer')
    expect(front).toContain('mcp__yart__submit_verdict')
    expect(front).not.toMatch(/\bEdit\b|\bWrite\b|\bBash\b/)
  })

  it('is written into the project', async () => {
    expect(await installReviewerAgent({ project_path: repo.path })).toBe(agentPath())
    expect(readFileSync(agentPath(), 'utf8')).toBe(REVIEWER_AGENT)
  })

  it('refuses to replace a file with the same name that yart did not write', async () => {
    mkdirSync(join(repo.path, '.claude', 'agents'), { recursive: true })
    writeFileSync(agentPath(), 'my own reviewer\n')
    await expect(installReviewerAgent({ project_path: repo.path })).rejects.toThrow(/did not write/)
    expect(await uninstallReviewerAgent({ project_path: repo.path })).toBe(false)
    expect(readFileSync(agentPath(), 'utf8')).toBe('my own reviewer\n')
  })

  it('is removed again', async () => {
    await installReviewerAgent({ project_path: repo.path })
    expect(await uninstallReviewerAgent({ project_path: repo.path })).toBe(true)
    expect(await uninstallReviewerAgent({ project_path: repo.path })).toBe(false)
  })
})
