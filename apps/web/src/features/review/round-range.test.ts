import type { FileDiff, Review, ReviewSubmission, Thread } from '@yart/core'
import { describe, expect, it } from 'vitest'
import { defaultRange, headSideOnly, openThreadsOutside, roundOf, sinceHead } from './round-range'
import { anchorKey } from './thread-anchors'

const verdict = (head_sha: string, author: 'human' | 'reviewer' = 'human'): ReviewSubmission =>
  ({ id: `s-${head_sha}`, verdict: 'changes_requested', author, head_sha }) as ReviewSubmission

const review = (rounds: string[], submissions: ReviewSubmission[] = []): Review =>
  ({ rounds, head_sha: rounds[rounds.length - 1], submissions }) as Review

describe('sinceHead', () => {
  it('is null for a review with one round', () => {
    expect(sinceHead(review(['h1']))).toBeNull()
  })

  it('is the round before this one when the person gave no verdict', () => {
    expect(sinceHead(review(['h1', 'h2', 'h3']))).toBe('h2')
  })

  it('is the head of the last verdict of the person, over more than one round', () => {
    expect(sinceHead(review(['h1', 'h2', 'h3'], [verdict('h1'), verdict('h2', 'reviewer')]))).toBe(
      'h1',
    )
  })

  it('is the round before this one when the verdict is on the current head', () => {
    expect(sinceHead(review(['h1', 'h2'], [verdict('h2')]))).toBe('h1')
  })
})

describe('defaultRange', () => {
  it('opens on the new work when the agent moved the review after the verdict', () => {
    expect(defaultRange(review(['h1', 'h2'], [verdict('h1')]))).toBe('since')
  })

  it('opens on all changes before the person gave a verdict', () => {
    expect(defaultRange(review(['h1', 'h2'], [verdict('h1', 'reviewer')]))).toBe('all')
    expect(defaultRange(review(['h1']))).toBe('all')
  })

  it('opens on all changes when the verdict is on the current head', () => {
    expect(defaultRange(review(['h1', 'h2'], [verdict('h2')]))).toBe('all')
  })
})

describe('roundOf', () => {
  it('numbers the rounds from 1', () => {
    expect(roundOf(review(['h1', 'h2']), 'h2')).toBe(2)
  })
})

describe('headSideOnly', () => {
  it('drops the anchors on the base side', () => {
    const by_anchor = new Map([
      [anchorKey('a.ts', 'base', 3), 'base'],
      [anchorKey('a.ts', 'head', 3), 'head'],
    ])
    expect([...headSideOnly(by_anchor).values()]).toEqual(['head'])
  })
})

describe('openThreadsOutside', () => {
  const file = (path: string, head_lines: number[]): FileDiff => ({
    status: 'modified',
    path,
    old_path: null,
    base_blob_sha: 'base',
    head_blob_sha: 'head',
    hunks: [
      {
        header: '@@',
        lines: head_lines.map((head_line) => ({
          kind: 'added',
          base_line: null,
          head_line,
          text: '',
        })),
      },
    ],
    is_binary: false,
    head_line_count: 100,
  })

  const thread = (
    id: string,
    anchor: { path: string; side: 'base' | 'head'; line: number } | null,
    status: 'open' | 'resolved' = 'open',
  ): Thread =>
    ({ id, status, anchor, origin: anchor ?? { path: 'gone.ts', side: 'head', line: 1 } }) as Thread

  const ids = (threads: Thread[]) => threads.map((each) => each.id)

  it('keeps an open thread on a line that the round did not change', () => {
    const threads = [
      thread('in', { path: 'a.ts', side: 'head', line: 4 }),
      thread('out', { path: 'a.ts', side: 'head', line: 40 }),
    ]
    expect(ids(openThreadsOutside(threads, [file('a.ts', [3, 4, 5])]))).toEqual(['out'])
  })

  it('keeps an open thread in a file that the round did not change', () => {
    const threads = [thread('other', { path: 'b.ts', side: 'head', line: 4 })]
    expect(ids(openThreadsOutside(threads, [file('a.ts', [4])]))).toEqual(['other'])
  })

  it('keeps an open thread on the base side', () => {
    const threads = [thread('base', { path: 'a.ts', side: 'base', line: 4 })]
    expect(ids(openThreadsOutside(threads, [file('a.ts', [4])]))).toEqual(['base'])
  })

  it('keeps an outdated thread only when its file is not in the view', () => {
    const threads = [thread('gone', null)]
    expect(ids(openThreadsOutside(threads, [file('gone.ts', [1])]))).toEqual([])
    expect(ids(openThreadsOutside(threads, [file('a.ts', [1])]))).toEqual(['gone'])
  })

  it('drops a resolved thread', () => {
    const threads = [thread('done', { path: 'b.ts', side: 'head', line: 4 }, 'resolved')]
    expect(openThreadsOutside(threads, [])).toEqual([])
  })
})
