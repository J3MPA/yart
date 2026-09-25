import { describe, expect, it } from 'vitest'
import { anchorKey } from './thread-anchors'
import {
  describeDraft,
  groupDrafts,
  isStale,
  newReplyDraft,
  newThreadDraft,
  type FileBlobs,
} from './drafts'

const files = (entries: Record<string, FileBlobs>) => new Map(Object.entries(entries))

const on_blob1 = newThreadDraft({ path: 'a.ts', side: 'head', line: 4, blob_sha: 'blob1' }, 'x')

describe('isStale', () => {
  it('keeps a line comment good while its file is unchanged', () => {
    expect(
      isStale(on_blob1, files({ 'a.ts': { head_blob_sha: 'blob1', base_blob_sha: 'b0' } })),
    ).toBe(false)
  })

  it('stays good through a round that only changed other files', () => {
    const later = files({
      'a.ts': { head_blob_sha: 'blob1', base_blob_sha: 'b0' },
      'other.ts': { head_blob_sha: 'changed', base_blob_sha: 'b1' },
    })
    expect(isStale(on_blob1, later)).toBe(false)
  })

  it('goes stale once its own file changes', () => {
    expect(
      isStale(on_blob1, files({ 'a.ts': { head_blob_sha: 'blob2', base_blob_sha: 'b0' } })),
    ).toBe(true)
  })

  it('goes stale when its file has left the review', () => {
    expect(isStale(on_blob1, files({}))).toBe(true)
  })

  it('checks the side the comment was written on', () => {
    const on_base = newThreadDraft({ path: 'a.ts', side: 'base', line: 2, blob_sha: 'b0' }, 'x')
    expect(
      isStale(on_base, files({ 'a.ts': { head_blob_sha: 'moved', base_blob_sha: 'b0' } })),
    ).toBe(false)
  })

  it('never counts a reply as stale, since its thread moves with the review', () => {
    expect(isStale(newReplyDraft('t1', 'ok'), files({}))).toBe(false)
  })
})

describe('groupDrafts', () => {
  const current = files({ 'a.ts': { head_blob_sha: 'blob1', base_blob_sha: 'b0' } })

  it('files a line comment under the row it belongs to', () => {
    expect(groupDrafts([on_blob1], current).by_anchor.get(anchorKey('a.ts', 'head', 4))).toEqual([
      on_blob1,
    ])
  })

  it('files a reply under its thread', () => {
    const reply = newReplyDraft('t1', 'agreed')
    expect(groupDrafts([reply], current).by_thread.get('t1')).toEqual([reply])
  })

  it('leaves a stale line comment out of the diff', () => {
    const moved = files({ 'a.ts': { head_blob_sha: 'blob2', base_blob_sha: 'b0' } })
    expect(groupDrafts([on_blob1], moved).by_anchor.size).toBe(0)
  })
})

describe('describeDraft', () => {
  it('names where a line comment sits', () => {
    expect(describeDraft(on_blob1)).toBe('a.ts:4')
  })

  it('marks a comment on the old side', () => {
    const on_base = newThreadDraft({ path: 'a.ts', side: 'base', line: 2, blob_sha: 'b0' }, 'x')
    expect(describeDraft(on_base)).toBe('a.ts:2 (old)')
  })
})
