import { describe, expect, it } from 'vitest'
import type { Comment, CommentAuthor, Review, ReviewSubmission, Thread } from '@yart/core'
import { buildHistory, hasAiReview } from './review-history'

const comment = (id: string, author: CommentAuthor, minute: number): Comment => ({
  id,
  author,
  body: id,
  created_at: `2026-10-14T10:${String(minute).padStart(2, '0')}:00.000Z`,
})

const thread = (line: number, comments: Comment[]): Thread =>
  ({
    id: `t${line}`,
    origin: { path: 'a.ts', blob_sha: 'b', line, side: 'head' },
    anchor: { path: 'a.ts', blob_sha: 'b', line, side: 'head' },
    comments,
  }) as unknown as Thread

const verdict = (
  id: string,
  minute: number,
  head_sha: string,
  author: 'human' | 'reviewer' = 'reviewer',
): ReviewSubmission => ({
  id,
  verdict: 'changes_requested',
  author,
  body: null,
  comments: [],
  head_sha,
  created_at: `2026-10-14T10:${String(minute).padStart(2, '0')}:00.000Z`,
})

const review = (threads: Thread[], submissions: ReviewSubmission[]): Review =>
  ({ rounds: ['h1', 'h2'], threads, submissions }) as unknown as Review

const ids = (blocks: ReturnType<typeof buildHistory>) =>
  blocks.map((block) => ({
    kind: block.kind,
    round: block.round,
    entries: block.entries.map((entry) => entry.comment.id),
  }))

describe('buildHistory', () => {
  it('puts the comments of a reviewer with its verdict, and the answers of the agent after it', () => {
    const history = buildHistory(
      review(
        [
          thread(2, [comment('rename this', 'reviewer', 1), comment('renamed', 'agent', 3)]),
          thread(5, [comment('looks good now', 'reviewer', 6)]),
        ],
        [verdict('v1', 1, 'h1'), verdict('v2', 6, 'h2')],
      ),
    )
    expect(ids(history)).toEqual([
      { kind: 'verdict', round: 1, entries: ['rename this', 'renamed'] },
      { kind: 'verdict', round: 2, entries: ['looks good now'] },
    ])
  })

  it('keeps the comments of the person apart from the verdicts of a reviewer', () => {
    const history = buildHistory(
      review(
        [thread(2, [comment('early note', 'human', 0)]), thread(3, [comment('mine', 'human', 8)])],
        [verdict('v1', 1, 'h1'), verdict('final', 9, 'h2', 'human')],
      ),
    )
    expect(ids(history)).toEqual([
      { kind: 'verdict', round: 1, entries: [] },
      { kind: 'verdict', round: 2, entries: ['early note', 'mine'] },
    ])
  })

  it('collects comments with no verdict yet after the last verdict', () => {
    const history = buildHistory(
      review([thread(2, [comment('not sent', 'human', 9)])], [verdict('v1', 1, 'h1')]),
    )
    expect(ids(history).at(-1)).toEqual({ kind: 'since', round: null, entries: ['not sent'] })
  })

  it('puts a reply of the agent before any verdict in a step of its own', () => {
    const history = buildHistory(review([thread(2, [comment('hello', 'agent', 0)])], []))
    expect(ids(history)).toEqual([{ kind: 'before', round: null, entries: ['hello'] }])
  })

  it('keeps the replies to a verdict with that verdict', () => {
    const answered = { ...verdict('v1', 1, 'h1'), comments: [comment('done', 'agent', 2)] }
    expect(ids(buildHistory(review([], [answered])))).toEqual([
      { kind: 'verdict', round: 1, entries: ['done'] },
    ])
  })
})

describe('hasAiReview', () => {
  it('tells if a reviewer gave a verdict', () => {
    expect(hasAiReview(review([], [verdict('v', 1, 'h1')]))).toBe(true)
    expect(hasAiReview(review([], [verdict('v', 1, 'h1', 'human')]))).toBe(false)
  })
})
