import { describe, expect, it } from 'vitest'
import type { FileDiff, Thread } from '@yart/core'
import { summarizeFile, threadIsOn } from './file-summary'

const file = (hunks: FileDiff['hunks']): FileDiff => ({
  status: 'modified',
  path: 'a.ts',
  old_path: null,
  base_blob_sha: 'base',
  head_blob_sha: 'head',
  hunks,
  is_binary: false,
  head_line_count: 10,
})

const thread = (partial: Partial<Thread> & Pick<Thread, 'anchor'>): Thread => ({
  id: 't',
  origin: { path: 'a.ts', blob_sha: 'base', line: 1, side: 'head' },
  context: { before: [], line: '', after: [] },
  anchor_state: 'current',
  status: 'open',
  comments: [],
  ...partial,
})

const anchorOn = (path: string) => ({ path, blob_sha: 'head', line: 3, side: 'head' as const })

describe('threadIsOn', () => {
  it('matches where the thread points now', () => {
    expect(threadIsOn(thread({ anchor: anchorOn('a.ts') }), 'a.ts')).toBe(true)
    expect(threadIsOn(thread({ anchor: anchorOn('b.ts') }), 'a.ts')).toBe(false)
  })

  it('falls back to where the thread started once the line is gone', () => {
    const outdated = thread({ anchor: null, anchor_state: 'outdated' })
    expect(threadIsOn(outdated, 'a.ts')).toBe(true)
    expect(threadIsOn(outdated, 'b.ts')).toBe(false)
  })

  it('follows a rename to the new path', () => {
    expect(threadIsOn(thread({ anchor: anchorOn('renamed.ts') }), 'renamed.ts')).toBe(true)
  })
})

describe('summarizeFile', () => {
  it('counts added and removed lines, ignoring context', () => {
    const summary = summarizeFile(
      file([
        {
          header: '@@ -1,3 +1,4 @@',
          lines: [
            { kind: 'context', base_line: 1, head_line: 1, text: 'a' },
            { kind: 'removed', base_line: 2, head_line: null, text: 'b' },
            { kind: 'added', base_line: null, head_line: 2, text: 'c' },
            { kind: 'added', base_line: null, head_line: 3, text: 'd' },
          ],
        },
      ]),
      [],
    )
    expect(summary).toMatchObject({ added: 2, removed: 1 })
  })

  it('counts open threads apart from the total', () => {
    const summary = summarizeFile(file([]), [
      thread({ id: '1', anchor: anchorOn('a.ts') }),
      thread({ id: '2', anchor: anchorOn('a.ts'), status: 'resolved' }),
      thread({ id: '3', anchor: anchorOn('other.ts') }),
    ])
    expect(summary).toMatchObject({ open_threads: 1, total_threads: 2 })
  })

  it('counts an outdated thread against the file it started on', () => {
    const summary = summarizeFile(file([]), [thread({ anchor: null, anchor_state: 'outdated' })])
    expect(summary).toMatchObject({ open_threads: 1, total_threads: 1 })
  })
})
