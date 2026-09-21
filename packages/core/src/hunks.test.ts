import { describe, expect, it } from 'vitest'
import {
  gapLines,
  gapSlice,
  hunkSectionHeading,
  parseHunkHeader,
  planDiffSections,
} from './hunks.ts'
import type { DiffHunk } from './review.ts'

/** Only the header matters to the planner, so the lines stay empty. */
const hunk = (header: string): DiffHunk => ({ header, lines: [] })

const gaps = (headers: readonly string[], head_line_count: number | null) =>
  planDiffSections(headers.map(hunk), head_line_count)
    .filter((section) => section.kind === 'gap')
    .map((section) => section.gap)

describe('parseHunkHeader', () => {
  it('reads both ranges', () => {
    expect(parseHunkHeader('@@ -7,7 +9,10 @@')).toEqual({
      base_start: 7,
      base_count: 7,
      head_start: 9,
      head_count: 10,
    })
  })

  it('treats an omitted count as one line', () => {
    expect(parseHunkHeader('@@ -3 +3 @@')).toEqual({
      base_start: 3,
      base_count: 1,
      head_start: 3,
      head_count: 1,
    })
  })

  it('keeps a zero count', () => {
    expect(parseHunkHeader('@@ -0,0 +1,4 @@')?.base_count).toBe(0)
  })

  it('ignores the section heading git appends', () => {
    expect(parseHunkHeader('@@ -1,2 +1,2 @@ export const thing = () => {')?.head_start).toBe(1)
  })

  it('returns null for anything else', () => {
    expect(parseHunkHeader('+++ b/a.txt')).toBeNull()
  })
})

describe('planDiffSections', () => {
  it('keeps the hunks in order and numbers them', () => {
    const sections = planDiffSections([hunk('@@ -7,7 +7,7 @@'), hunk('@@ -27,7 +27,7 @@')], 40)
    expect(sections.map((section) => section.kind)).toEqual(['gap', 'hunk', 'gap', 'hunk', 'gap'])
    expect(sections.filter((section) => section.kind === 'hunk').map((s) => s.index)).toEqual([
      0, 1,
    ])
  })

  it('finds the run before the first hunk', () => {
    expect(gaps(['@@ -7,7 +7,7 @@'], null)[0]).toEqual({
      base_start: 1,
      head_start: 1,
      length: 6,
    })
  })

  it('finds the run after the last hunk', () => {
    expect(gaps(['@@ -7,7 +7,7 @@'], 20).at(-1)).toEqual({
      base_start: 14,
      head_start: 14,
      length: 7,
    })
  })

  it('keeps the two sides in step across an insertion', () => {
    // Three lines added inside the hunk, so the tail sits three lines lower on
    // the head than on the base.
    expect(gaps(['@@ -7,7 +7,10 @@'], 23).at(-1)).toEqual({
      base_start: 14,
      head_start: 17,
      length: 7,
    })
  })

  it('finds the run between two hunks', () => {
    const between = gaps(['@@ -7,7 +7,10 @@', '@@ -27,7 +30,7 @@'], 43)[1]
    expect(between).toEqual({ base_start: 14, head_start: 17, length: 13 })
  })

  it('leaves the tail off when the head length is unknown', () => {
    expect(gaps(['@@ -7,7 +7,7 @@'], null)).toEqual([{ base_start: 1, head_start: 1, length: 6 }])
  })

  it('reports no gaps for a whole deleted file', () => {
    expect(gaps(['@@ -1,4 +0,0 @@'], null)).toEqual([])
  })

  it('reports no gaps for a whole added file', () => {
    expect(gaps(['@@ -0,0 +1,4 @@'], 4)).toEqual([])
  })

  it('treats a file with no hunks as one long run', () => {
    expect(gaps([], 12)).toEqual([{ base_start: 1, head_start: 1, length: 12 }])
  })

  it('does not invent a run where a hunk starts on line one', () => {
    expect(gaps(['@@ -1,4 +1,4 @@'], 4)).toEqual([])
  })

  it('counts a pure insertion as consuming nothing on the base', () => {
    // `-10,0` sits after base line 10, so base line 11 is still unchanged.
    expect(gaps(['@@ -10,0 +11,2 @@'], 14).at(-1)).toEqual({
      base_start: 11,
      head_start: 13,
      length: 2,
    })
  })
})

describe('hunkSectionHeading', () => {
  it('keeps the context git appended', () => {
    expect(hunkSectionHeading('@@ -1,2 +1,2 @@ export const thing = () => {')).toBe(
      'export const thing = () => {',
    )
  })

  it('is empty when git found nothing to name', () => {
    expect(hunkSectionHeading('@@ -1,2 +1,2 @@')).toBe('')
  })
})

describe('gapSlice', () => {
  it('moves both sides by the same offset', () => {
    expect(gapSlice({ base_start: 14, head_start: 17, length: 13 }, 3, 4)).toEqual({
      base_start: 17,
      head_start: 20,
      length: 4,
    })
  })
})

describe('gapLines', () => {
  const head = ['one', 'two', 'three', 'four', 'five']

  it('reads the run off the head and numbers both sides', () => {
    expect(gapLines({ base_start: 1, head_start: 3, length: 2 }, head)).toEqual([
      { kind: 'context', base_line: 1, head_line: 3, text: 'three' },
      { kind: 'context', base_line: 2, head_line: 4, text: 'four' },
    ])
  })

  it('falls back to an empty line rather than undefined past the end', () => {
    expect(gapLines({ base_start: 5, head_start: 5, length: 2 }, head)[1]).toMatchObject({
      text: '',
    })
  })
})
