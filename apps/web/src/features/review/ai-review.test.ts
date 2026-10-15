import { describe, expect, it } from 'vitest'
import type { Comment, CommentAuthor, Review, ReviewSubmission, Thread } from '@yart/core'
import { aiPhase, personSubmittedOnHead } from './ai-review'

const comment = (author: CommentAuthor, created_at: string): Comment => ({
  id: `${author}-${created_at}`,
  author,
  body: 'text',
  created_at,
})

const thread = (comments: Comment[], status: Thread['status'] = 'open'): Thread =>
  ({ id: 't', status, comments }) as Thread

const submission = (
  author: ReviewSubmission['author'],
  verdict: ReviewSubmission['verdict'],
  head_sha = 'head1',
): ReviewSubmission => ({
  id: `${author}-${verdict}-${head_sha}`,
  verdict,
  author,
  body: null,
  comments: [],
  head_sha,
  created_at: '2026-09-25T12:00:00.000Z',
})

const review = (partial: Partial<Review>): Review =>
  ({ head_sha: 'head1', submissions: [], threads: [], ...partial }) as Review

describe('aiPhase', () => {
  it('is null for a review with no verdict', () => {
    expect(aiPhase(review({}), 3)).toBeNull()
  })

  it('is null when the person gave the latest verdict', () => {
    const submissions = [submission('reviewer', 'approved'), submission('human', 'commented')]
    expect(aiPhase(review({ submissions }), 3)).toBeNull()
  })

  it('treats a verdict with no author as a verdict of the person', () => {
    const legacy = { ...submission('human', 'approved'), author: undefined }
    expect(aiPhase(review({ submissions: [legacy] }), 3)).toBeNull()
  })

  it('waits on the agent after a verdict of the AI reviewer', () => {
    const phase = aiPhase(review({ submissions: [submission('reviewer', 'changes_requested')] }), 3)
    expect(phase).toEqual({
      verdict: 'changes_requested',
      author_name: null,
      rounds_used: 1,
      round_limit: 3,
      next: 'agent',
    })
  })

  it('waits on the AI reviewer after the agent moved the review', () => {
    const phase = aiPhase(
      review({ head_sha: 'head2', submissions: [submission('reviewer', 'changes_requested')] }),
      3,
    )
    expect(phase?.next).toBe('reviewer')
  })

  it('waits on the AI reviewer after the agent answered each thread', () => {
    const answered = thread([
      comment('reviewer', '2026-09-25T11:00:00.000Z'),
      comment('agent', '2026-09-25T13:00:00.000Z'),
    ])
    const phase = aiPhase(
      review({ submissions: [submission('reviewer', 'commented')], threads: [answered] }),
      3,
    )
    expect(phase?.next).toBe('reviewer')
  })

  it('waits on the person after an AI approval', () => {
    const phase = aiPhase(review({ submissions: [submission('reviewer', 'approved')] }), 3)
    expect(phase?.next).toBe('person')
  })

  it('waits on the person when the AI reviewer has no rounds left', () => {
    const submissions = [
      submission('reviewer', 'changes_requested', 'head1'),
      submission('reviewer', 'changes_requested', 'head2'),
    ]
    const phase = aiPhase(review({ head_sha: 'head3', submissions }), 2)
    expect(phase).toMatchObject({ rounds_used: 2, next: 'person' })
  })
})

describe('personSubmittedOnHead', () => {
  it('ignores a verdict of an AI reviewer', () => {
    expect(
      personSubmittedOnHead(review({ submissions: [submission('reviewer', 'approved')] })),
    ).toBe(false)
  })

  it('counts a verdict of the person on the current head', () => {
    expect(personSubmittedOnHead(review({ submissions: [submission('human', 'commented')] }))).toBe(
      true,
    )
  })

  it('ignores a verdict of the person on an earlier head', () => {
    const moved = review({ head_sha: 'head2', submissions: [submission('human', 'approved')] })
    expect(personSubmittedOnHead(moved)).toBe(false)
  })
})
