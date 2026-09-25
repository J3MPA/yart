import { describe, expect, it } from 'vitest'
import { currentSubmission, reviewProgress, threadIsAnswered } from './progress.ts'
import type { Review, ReviewSubmission } from './review.ts'
import type { Comment, CommentAuthor, Thread } from './types.ts'

const comment = (author: CommentAuthor): Comment => ({
  id: `c-${author}-${Math.random()}`,
  author,
  body: 'text',
  created_at: '2026-09-25T12:00:00.000Z',
})

const thread = (authors: readonly CommentAuthor[], status: Thread['status'] = 'open'): Thread =>
  ({ id: 't', status, comments: authors.map(comment) }) as Thread

const submission = (head_sha: string, comments: Comment[] = []): ReviewSubmission => ({
  id: 's',
  verdict: 'changes_requested',
  body: null,
  comments,
  head_sha,
  created_at: '2026-09-25T12:00:00.000Z',
})

const review = (partial: Partial<Review>): Review =>
  ({ head_sha: 'head2', submissions: [], threads: [], ...partial }) as Review

describe('currentSubmission', () => {
  it('is null before anything is submitted', () => {
    expect(currentSubmission(review({}))).toBeNull()
  })

  it('ignores a verdict from an earlier round', () => {
    expect(currentSubmission(review({ submissions: [submission('head1')] }))).toBeNull()
  })

  it('takes the latest when a round was submitted more than once', () => {
    const later = { ...submission('head2'), id: 'later' }
    expect(currentSubmission(review({ submissions: [submission('head2'), later] }))?.id).toBe(
      'later',
    )
  })
})

describe('threadIsAnswered', () => {
  it('is false when the human spoke last', () => {
    expect(threadIsAnswered(thread(['human']))).toBe(false)
  })

  it('is true when the agent spoke last', () => {
    expect(threadIsAnswered(thread(['human', 'agent']))).toBe(true)
  })

  it('goes back to waiting when the human answers the agent', () => {
    expect(threadIsAnswered(thread(['human', 'agent', 'human']))).toBe(false)
  })

  it('counts a resolved thread as answered whoever spoke last', () => {
    expect(threadIsAnswered(thread(['human'], 'resolved'))).toBe(true)
  })
})

describe('reviewProgress', () => {
  it('is null before the review has been handed back', () => {
    expect(reviewProgress(review({ threads: [thread(['human'])] }))).toBeNull()
  })

  it('is idle when nothing has happened since the verdict', () => {
    const progress = reviewProgress(
      review({ submissions: [submission('head2')], threads: [thread(['human'])] }),
    )
    expect(progress).toMatchObject({ state: 'idle', answered_threads: 0, awaiting_threads: 1 })
  })

  it('is in progress when some threads are answered and others are not', () => {
    const progress = reviewProgress(
      review({
        submissions: [submission('head2')],
        threads: [thread(['human', 'agent']), thread(['human'])],
      }),
    )
    expect(progress).toMatchObject({ state: 'in_progress', answered_threads: 1 })
  })

  it('is in progress when the code moved but comments are still waiting', () => {
    // Changes without answers are not an invitation to look again.
    const progress = reviewProgress(
      review({ submissions: [submission('head1')], threads: [thread(['human'])] }),
    )
    expect(progress).toMatchObject({ state: 'in_progress', code_changed: true })
  })

  it('is ready once every thread has been answered', () => {
    const progress = reviewProgress(
      review({
        submissions: [submission('head2')],
        threads: [thread(['human', 'agent']), thread(['human'], 'resolved')],
      }),
    )
    expect(progress).toMatchObject({ state: 'ready', answered_threads: 2, awaiting_threads: 0 })
  })

  it('does not require the code to have moved to be ready', () => {
    const progress = reviewProgress(
      review({ submissions: [submission('head2')], threads: [thread(['human', 'agent'])] }),
    )
    expect(progress).toMatchObject({ state: 'ready', code_changed: false })
  })

  it('counts a reply under the verdict as activity on its own', () => {
    const progress = reviewProgress(
      review({ submissions: [submission('head2', [comment('agent')])] }),
    )
    expect(progress).toMatchObject({ state: 'ready', summary_answered: true })
  })

  it('stays idle when the only reply under the verdict is the human’s own', () => {
    const progress = reviewProgress(
      review({ submissions: [submission('head2', [comment('human')])] }),
    )
    expect(progress).toMatchObject({ state: 'idle', summary_answered: false })
  })

  it('is idle for an approval with nothing to do', () => {
    expect(reviewProgress(review({ submissions: [submission('head2')] }))?.state).toBe('idle')
  })
})
