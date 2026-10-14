import { describe, expect, it } from 'vitest'
import { describeAuthor, submissionAuthor } from './authors.ts'
import type { ReviewSubmission } from './review.ts'

const submission = (overrides: Partial<ReviewSubmission> = {}): ReviewSubmission => ({
  id: 's',
  verdict: 'approved',
  body: null,
  comments: [],
  head_sha: 'h',
  created_at: '2026-10-14T00:00:00.000Z',
  ...overrides,
})

describe('submissionAuthor', () => {
  it('reads a verdict from before reviewers existed as the person’s', () => {
    expect(submissionAuthor(submission())).toBe('human')
  })

  it('reads a reviewer’s verdict as the reviewer’s', () => {
    expect(submissionAuthor(submission({ author: 'reviewer' }))).toBe('reviewer')
  })
})

describe('describeAuthor', () => {
  it('shows the person and the agent by their role', () => {
    expect(describeAuthor('human', undefined)).toBe('human')
    expect(describeAuthor('agent', null)).toBe('agent')
  })

  it('shows an AI reviewer by its name, or as a reviewer without one', () => {
    expect(describeAuthor('reviewer', 'claude-reviewer')).toBe('reviewer claude-reviewer')
    expect(describeAuthor('reviewer', null)).toBe('reviewer')
  })
})
