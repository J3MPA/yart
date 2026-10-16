import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  installReviewerAgent,
  REVIEWER_FILE_NAME,
  reviewerAgent,
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
    const front = reviewerAgent('/bin/yart-mcp').split('---')[1] ?? ''
    expect(front).toContain('name: yart-reviewer')
    expect(front).toContain('mcp__yart-reviewer__submit_verdict')
    expect(front).not.toContain('mcp__yart__')
    expect(front).not.toMatch(/\bEdit\b|\bWrite\b|\bBash\b/)
  })

  it('treats the description of the author as a claim', () => {
    expect(reviewerAgent('/bin/yart-mcp')).toContain('It is\n  a claim, not evidence.')
  })

  it('has its own MCP server with the reviewer role', () => {
    const front = reviewerAgent('/opt/yart/bin/yart-mcp').split('---')[1] ?? ''
    expect(front).toContain('  - yart-reviewer:')
    expect(front).toContain('command: "/opt/yart/bin/yart-mcp"')
    expect(front).toContain('args: ["--role", "reviewer"]')
  })

  it('is written into the project', async () => {
    expect(await installReviewerAgent({ project_path: repo.path }, '/bin/yart-mcp')).toBe(
      agentPath(),
    )
    expect(readFileSync(agentPath(), 'utf8')).toBe(reviewerAgent('/bin/yart-mcp'))
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
