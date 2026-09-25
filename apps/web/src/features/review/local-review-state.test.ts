import { describe, expect, it } from 'vitest'
import {
  addDraft,
  clearDrafts,
  forgetDeleted,
  isReviewed,
  localFor,
  removeDraft,
  reviewBlob,
  setReviewed,
  toggleFolded,
  updateDraft,
  type Draft,
} from './local-review-state'

const draft = (id: string): Draft => ({
  id,
  kind: 'thread',
  path: 'a.ts',
  side: 'head',
  line: 3,
  body: `draft ${id}`,
  blob_sha: 'blob1',
  created_at: '2026-09-25T12:00:00.000Z',
})

describe('toggleFolded', () => {
  it('folds a directory, then unfolds it', () => {
    const folded = toggleFolded({}, 'r1', 'src/lib')
    expect(localFor(folded, 'r1').folded).toEqual(['src/lib'])
    expect(localFor(toggleFolded(folded, 'r1', 'src/lib'), 'r1').folded).toEqual([])
  })

  it('keeps each review to itself', () => {
    const folded = toggleFolded({}, 'r1', 'src')
    expect(localFor(folded, 'r2').folded).toEqual([])
  })
})

describe('reviewed files', () => {
  it('counts a file reviewed at the blob it was marked at', () => {
    const state = setReviewed({}, 'r1', 'a.ts', 'blob1')
    expect(isReviewed(localFor(state, 'r1'), 'a.ts', 'blob1')).toBe(true)
  })

  it('stops counting a file once its content has changed', () => {
    const state = setReviewed({}, 'r1', 'a.ts', 'blob1')
    expect(isReviewed(localFor(state, 'r1'), 'a.ts', 'blob2')).toBe(false)
  })

  it('clears the mark when asked', () => {
    const marked = setReviewed({}, 'r1', 'a.ts', 'blob1')
    const cleared = setReviewed(marked, 'r1', 'a.ts', null)
    expect(isReviewed(localFor(cleared, 'r1'), 'a.ts', 'blob1')).toBe(false)
  })
})

describe('drafts', () => {
  it('adds, edits and drops a draft', () => {
    const added = addDraft({}, 'r1', draft('d1'))
    const edited = updateDraft(added, 'r1', 'd1', 'reworded')
    expect(localFor(edited, 'r1').drafts[0]?.body).toBe('reworded')
    expect(localFor(removeDraft(edited, 'r1', 'd1'), 'r1').drafts).toEqual([])
  })

  it('clears every draft once the review is sent, leaving the rest alone', () => {
    const state = setReviewed(addDraft({}, 'r1', draft('d1')), 'r1', 'a.ts', 'blob1')
    const cleared = localFor(clearDrafts(state, 'r1'), 'r1')
    expect(cleared.drafts).toEqual([])
    expect(cleared.reviewed).toEqual({ 'a.ts': 'blob1' })
  })
})

describe('forgetDeleted', () => {
  it('keeps only reviews that still exist', () => {
    const state = addDraft(addDraft({}, 'r1', draft('d1')), 'gone', draft('d2'))
    expect(Object.keys(forgetDeleted(state, ['r1']))).toEqual(['r1'])
  })
})

describe('reviewBlob', () => {
  it('reviews a file as it now stands', () => {
    expect(reviewBlob({ head_blob_sha: 'head', base_blob_sha: 'base' })).toBe('head')
  })

  it('reviews a deleted file as it last stood', () => {
    expect(reviewBlob({ head_blob_sha: null, base_blob_sha: 'base' })).toBe('base')
  })
})
