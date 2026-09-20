import { createThread, type Comment, type Thread } from '@yart/core'
import { describe, expect, it } from 'vitest'
import {
  anchorKey,
  countOpen,
  groupThreadsByAnchor,
  outdatedThreads,
  outdatedThreadsForPath,
} from './thread-anchors'

const COMMENT: Comment = {
  id: 'c1',
  author: 'human',
  body: 'look at this',
  created_at: '2026-09-20T12:00:00.000Z',
}

const CONTENT = 'one\ntwo\nthree\n'

const makeThread = (
  id: string,
  path: string,
  line: number,
  side: 'base' | 'head' = 'head',
): Thread =>
  createThread({
    id,
    anchor: { path, blob_sha: 'blob1', line, side },
    content: CONTENT,
    comment: COMMENT,
  })

describe('anchorKey', () => {
  it('separates the two sides of the same line', () => {
    expect(anchorKey('a.ts', 'base', 4)).not.toBe(anchorKey('a.ts', 'head', 4))
  })

  it('separates the same line in different files', () => {
    expect(anchorKey('a.ts', 'head', 4)).not.toBe(anchorKey('b.ts', 'head', 4))
  })

  it('does not collide when a path contains the separator characters', () => {
    expect(anchorKey('a:1', 'head', 2)).not.toBe(anchorKey('a', 'head', 12))
  })
})

describe('groupThreadsByAnchor', () => {
  it('keys a thread by the row it belongs under', () => {
    const thread = makeThread('t1', 'a.ts', 2)
    const grouped = groupThreadsByAnchor([thread])
    expect(grouped.get(anchorKey('a.ts', 'head', 2))).toEqual([thread])
  })

  it('collects several threads on the same line', () => {
    const grouped = groupThreadsByAnchor([makeThread('t1', 'a.ts', 2), makeThread('t2', 'a.ts', 2)])
    expect(grouped.get(anchorKey('a.ts', 'head', 2))).toHaveLength(2)
  })

  it('keeps base-side and head-side threads apart', () => {
    const grouped = groupThreadsByAnchor([
      makeThread('t1', 'a.ts', 2, 'head'),
      makeThread('t2', 'a.ts', 2, 'base'),
    ])
    expect(grouped.get(anchorKey('a.ts', 'head', 2))?.[0]?.id).toBe('t1')
    expect(grouped.get(anchorKey('a.ts', 'base', 2))?.[0]?.id).toBe('t2')
  })

  it('leaves out threads with no anchor, since they have no row', () => {
    const outdated: Thread = { ...makeThread('t1', 'a.ts', 2), anchor: null }
    expect(groupThreadsByAnchor([outdated]).size).toBe(0)
  })
})

describe('outdatedThreads', () => {
  it('returns only threads whose line is gone', () => {
    const live = makeThread('t1', 'a.ts', 2)
    const dead: Thread = { ...makeThread('t2', 'a.ts', 3), anchor: null }
    expect(outdatedThreads([live, dead]).map((thread) => thread.id)).toEqual(['t2'])
  })

  it('matches an outdated thread on where it started, since it has no anchor', () => {
    const dead: Thread = { ...makeThread('t1', 'a.ts', 2), anchor: null }
    expect(outdatedThreadsForPath([dead], 'a.ts')).toHaveLength(1)
    expect(outdatedThreadsForPath([dead], 'b.ts')).toHaveLength(0)
  })
})

describe('countOpen', () => {
  it('counts unresolved threads only', () => {
    const resolved: Thread = { ...makeThread('t2', 'a.ts', 3), status: 'resolved' }
    expect(countOpen([makeThread('t1', 'a.ts', 2), resolved])).toBe(1)
  })
})
