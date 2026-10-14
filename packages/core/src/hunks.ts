import type { DiffHunk, DiffLine } from './review.ts'

/** The two line ranges that a `@@ ... @@` header names, one for each side. */
export interface HunkRange {
  base_start: number
  base_count: number
  head_start: number
  head_count: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Reads the line ranges from a hunk header. Returns null if the text is not a
 * hunk header.
 *
 * A count of zero marks a side where the hunk adds nothing. The start then
 * names the line *before* the change, not the first line of the change. When
 * the count is missing, it is one line. This is a short form of git.
 */
export const parseHunkHeader = (header: string): HunkRange | null => {
  const match = HUNK_HEADER.exec(header)
  if (match === null) return null
  return {
    base_start: Number(match[1]),
    base_count: match[2] === undefined ? 1 : Number(match[2]),
    head_start: Number(match[3]),
    head_count: match[4] === undefined ? 1 : Number(match[4]),
  }
}

/** The first line of a hunk on each side. */
export const hunkFirstLines = (range: HunkRange): { base: number; head: number } => ({
  base: range.base_count === 0 ? range.base_start + 1 : range.base_start,
  head: range.head_count === 0 ? range.head_start + 1 : range.head_start,
})

/** The line after the last line of a hunk on each side. */
export const hunkNextLines = (range: HunkRange): { base: number; head: number } => {
  const first = hunkFirstLines(range)
  return { base: first.base + range.base_count, head: first.head + range.head_count }
}

/** A run of unchanged lines that the diff did not include, on the two sides. */
export interface DiffGap {
  /** 1-based first line of the run in the base blob. */
  base_start: number
  /** 1-based first line of the run in the head blob. */
  head_start: number
  /** How many lines the run hides. It is always one or more. */
  length: number
}

/** The diff of a file in the order to read it: the hunks from git and the gaps between them. */
export type DiffSection =
  { kind: 'gap'; gap: DiffGap } | { kind: 'hunk'; hunk: DiffHunk; index: number }

/**
 * Puts the hunks of a file in order, with the unchanged runs between them.
 *
 * git shows only what changed. All lines between two hunks, and all lines after
 * the last hunk, are not in the diff. This function finds the gaps from the two
 * sides together. A line that is not in a hunk did not change. An unchanged line
 * moves the two sides forward by the same count.
 *
 * `head_line_count` gives the end of the last gap. Without it, nothing tells if
 * lines follow the last hunk. Thus a null gives no last gap.
 */
export const planDiffSections = (
  hunks: readonly DiffHunk[],
  head_line_count: number | null,
): DiffSection[] => {
  const sections: DiffSection[] = []
  let base_next = 1
  let head_next = 1

  const pushGap = (until_head: number) => {
    const length = until_head - head_next
    if (length <= 0) return
    sections.push({ kind: 'gap', gap: { base_start: base_next, head_start: head_next, length } })
  }

  hunks.forEach((hunk, index) => {
    const range = parseHunkHeader(hunk.header)
    if (range === null) {
      sections.push({ kind: 'hunk', hunk, index })
      return
    }

    pushGap(hunkFirstLines(range).head)
    sections.push({ kind: 'hunk', hunk, index })

    const next = hunkNextLines(range)
    base_next = next.base
    head_next = next.head
  })

  if (head_line_count !== null) pushGap(head_line_count + 1)

  return sections
}

/** Removes the `@@ ... @@` numbers. The context that git found stays, if there is one. */
export const hunkSectionHeading = (header: string): string =>
  header.replace(/^@@ [^@]* @@/, '').trim()

/** The part of a run that starts `offset` lines in, for `length` lines. */
export const gapSlice = (gap: DiffGap, offset: number, length: number): DiffGap => ({
  base_start: gap.base_start + offset,
  head_start: gap.head_start + offset,
  length,
})

/**
 * The hidden lines of a run, as the context rows that the diff would show.
 *
 * The lines come from the head. A run did not change, thus the two sides have
 * the same text. Only the head is still on the disk.
 */
export const gapLines = (gap: DiffGap, head_lines: readonly string[]): DiffLine[] =>
  Array.from({ length: gap.length }, (_unused, index) => ({
    kind: 'context' as const,
    base_line: gap.base_start + index,
    head_line: gap.head_start + index,
    text: head_lines[gap.head_start + index - 1] ?? '',
  }))
