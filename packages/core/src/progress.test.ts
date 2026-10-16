import { describe, expect, it } from 'vitest'
import {
  authorHasAnswered,
  authorIsDone,
  currentSubmission,
  reviewProgress,
  threadIsAnswered,
} from './progress.ts'
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
    // Changes without answers are not a reason to look again.
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

describe('authorHasAnswered', () => {
  const VERDICT_AT = '2026-09-25T12:00:00.000Z'
  const LATER = '2026-09-25T12:05:00.000Z'

  const said = (author: CommentAuthor, created_at = LATER): Comment => ({
    ...comment(author),
    created_at,
  })

  const reviewerThread = (id: string, ...later: Comment[]): Thread =>
    ({ id, status: 'open', comments: [said('reviewer', VERDICT_AT), ...later] }) as Thread

  const afterVerdict = (threads: Thread[], verdict_comments: Comment[] = []): Review =>
    review({
      head_sha: 'head1',
      threads,
      submissions: [
        { ...submission('head1', verdict_comments), author: 'reviewer', created_at: VERDICT_AT },
      ],
    })

  it('waits while the agent answered only some threads of the reviewer', () => {
    const answered = afterVerdict([reviewerThread('a', said('agent')), reviewerThread('b')])
    expect(authorHasAnswered(answered)).toBe(false)
  })

  it('wakes when the agent answered each open thread of the reviewer', () => {
    const answered = afterVerdict([
      reviewerThread('a', said('agent')),
      { ...reviewerThread('b'), status: 'resolved' },
    ])
    expect(authorHasAnswered(answered)).toBe(true)
  })

  it('wakes when the agent moved the review, also with no reply', () => {
    expect(authorHasAnswered({ ...afterVerdict([reviewerThread('a')]), head_sha: 'head2' })).toBe(
      true,
    )
  })

  it('wakes on a reply to a verdict with no line comments', () => {
    expect(authorHasAnswered(afterVerdict([], [said('agent')]))).toBe(true)
  })

  it('does not wait for the threads of the person', () => {
    const person = { id: 'p', status: 'open', comments: [said('human', VERDICT_AT)] } as Thread
    expect(authorHasAnswered(afterVerdict([person, reviewerThread('a', said('agent'))]))).toBe(true)
  })

  it('waits when the agent did nothing after the verdict', () => {
    expect(authorHasAnswered(afterVerdict([]))).toBe(false)
  })
})

describe('authorIsDone', () => {
  const VERDICT_AT = '2026-09-25T12:00:00.000Z'
  const REPLY_AT = '2026-09-25T12:05:00.000Z'
  const reply_time = Date.parse(REPLY_AT)
  const QUIET_MS = 60_000

  const replied = (head_sha: string): Review =>
    review({
      head_sha,
      threads: [
        {
          id: 'a',
          status: 'open',
          comments: [
            { ...comment('reviewer'), created_at: VERDICT_AT },
            { ...comment('agent'), created_at: REPLY_AT },
          ],
        } as Thread,
      ],
      submissions: [{ ...submission('head1'), author: 'reviewer', created_at: VERDICT_AT }],
    })

  it('waits while the author was quiet for less than the quiet time', () => {
    expect(authorIsDone(replied('head1'), QUIET_MS, reply_time + QUIET_MS - 1)).toBe(false)
  })

  it('wakes on replies with no new code after the quiet time', () => {
    expect(authorIsDone(replied('head1'), QUIET_MS, reply_time + QUIET_MS)).toBe(true)
  })

  it('wakes at once when the author moved the review', () => {
    expect(authorIsDone(replied('head2'), QUIET_MS, reply_time)).toBe(true)
  })

  it('waits when the author did not answer', () => {
    const silent = review({
      head_sha: 'head1',
      submissions: [{ ...submission('head1'), author: 'reviewer', created_at: VERDICT_AT }],
    })
    expect(authorIsDone(silent, QUIET_MS, reply_time + QUIET_MS)).toBe(false)
  })
})
