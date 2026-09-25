import { describe, expect, it } from 'vitest'
import { agentActivity } from './activity.ts'
import type { Review } from './review.ts'
import type { CommentAuthor, Comment, Thread } from './types.ts'

const comment = (author: CommentAuthor, id: string): Comment => ({
  id,
  author,
  body: 'text',
  created_at: '2026-09-25T12:00:00.000Z',
})

const thread = (authors: readonly CommentAuthor[], status: Thread['status'] = 'open'): Thread =>
  ({
    id: 't',
    status,
    comments: authors.map((author, index) => comment(author, `c${index}`)),
  }) as Thread

const review = (partial: Partial<Review>): Review =>
  ({ rounds: ['head1'], threads: [], submissions: [], ...partial }) as Review

describe('agentActivity', () => {
  it('counts the rounds a review has been through', () => {
    expect(agentActivity(review({ rounds: ['a', 'b'] }))).toBe(2)
  })

  it('does not move when only the human writes', () => {
    const before = agentActivity(review({ threads: [thread(['human'])] }))
    const after = agentActivity(review({ threads: [thread(['human', 'human'])] }))
    expect(after).toBe(before)
  })

  it('moves when the agent replies on a thread', () => {
    const before = agentActivity(review({ threads: [thread(['human'])] }))
    const after = agentActivity(review({ threads: [thread(['human', 'agent'])] }))
    expect(after).toBeGreaterThan(before)
  })

  it('moves when a thread is resolved without a reply', () => {
    const before = agentActivity(review({ threads: [thread(['human'])] }))
    const after = agentActivity(review({ threads: [thread(['human'], 'resolved')] }))
    expect(after).toBeGreaterThan(before)
  })

  it('moves when the agent answers the verdict', () => {
    const quiet = review({
      submissions: [{ comments: [comment('human', 'h')] }],
    } as unknown as Partial<Review>)
    const answered = review({
      submissions: [{ comments: [comment('human', 'h'), comment('agent', 'a')] }],
    } as unknown as Partial<Review>)
    expect(agentActivity(answered)).toBeGreaterThan(agentActivity(quiet))
  })

  it('moves when the review is advanced onto new work', () => {
    const before = agentActivity(review({ rounds: ['a'] }))
    const after = agentActivity(review({ rounds: ['a', 'b'] }))
    expect(after).toBeGreaterThan(before)
  })

  it('never goes down as a review accumulates', () => {
    const steps = [
      review({ rounds: ['a'] }),
      review({ rounds: ['a'], threads: [thread(['human', 'agent'])] }),
      review({ rounds: ['a', 'b'], threads: [thread(['human', 'agent'], 'resolved')] }),
    ].map(agentActivity)
    expect(steps).toEqual([...steps].sort((left, right) => left - right))
  })
})
