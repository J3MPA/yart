import type { Review, ReviewSubmission } from '@yart/core'
import { describe, expect, it } from 'vitest'
import { currentSubmission } from './submission'

const submission = (verdict: ReviewSubmission['verdict'], head_sha: string): ReviewSubmission => ({
  id: `s-${verdict}-${head_sha}`,
  verdict,
  body: null,
  head_sha,
  created_at: '2026-09-20T12:00:00.000Z',
})

const reviewWith = (submissions: ReviewSubmission[], head_sha = 'head2'): Review =>
  ({ head_sha, submissions }) as Review

describe('currentSubmission', () => {
  it('is null before anything is submitted', () => {
    expect(currentSubmission(reviewWith([]))).toBeNull()
  })

  it('returns the verdict passed on the current head', () => {
    const current = submission('approved', 'head2')
    expect(currentSubmission(reviewWith([current]))?.verdict).toBe('approved')
  })

  it('ignores a verdict from an earlier round', () => {
    // An approval of the previous head does not describe what is on screen now.
    expect(currentSubmission(reviewWith([submission('approved', 'head1')]))).toBeNull()
  })

  it('takes the latest when a round was submitted more than once', () => {
    const result = currentSubmission(
      reviewWith([submission('changes_requested', 'head2'), submission('approved', 'head2')]),
    )
    expect(result?.verdict).toBe('approved')
  })
})
