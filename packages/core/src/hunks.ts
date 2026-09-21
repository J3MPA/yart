import type { DiffHunk, DiffLine } from './review.ts'

/** The two line ranges a `@@ ... @@` header names, one per side. */
export interface HunkRange {
  base_start: number
  base_count: number
  head_start: number
  head_count: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Reads the line ranges out of a hunk header, or null if it is not one.
 *
 * A count of zero marks a side the hunk adds nothing to, and the start then
 * names the line the change sits *after* rather than the first line it covers.
 * An omitted count means one line, which is git's shorthand.
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

/** The first line a hunk actually covers on each side. */
export const hunkFirstLines = (range: HunkRange): { base: number; head: number } => ({
  base: range.base_count === 0 ? range.base_start + 1 : range.base_start,
  head: range.head_count === 0 ? range.head_start + 1 : range.head_start,
})

/** The line after the last one a hunk covers on each side. */
export const hunkNextLines = (range: HunkRange): { base: number; head: number } => {
  const first = hunkFirstLines(range)
  return { base: first.base + range.base_count, head: first.head + range.head_count }
}

/** A run of unchanged lines the diff left out, described on both sides. */
export interface DiffGap {
  /** 1-based first line of the run in the base blob. */
  base_start: number
  /** 1-based first line of the run in the head blob. */
  head_start: number
  /** How many lines the run hides. Always at least one. */
  length: number
}

/** A file's diff in reading order: the hunks git produced and the gaps between them. */
export type DiffSection =
  { kind: 'gap'; gap: DiffGap } | { kind: 'hunk'; hunk: DiffHunk; index: number }

/**
 * Lays a file's hunks out with the unchanged runs that separate them.
 *
 * git only describes what changed, so everything between two hunks — and
 * everything after the last one — is absent from the diff entirely. The gaps
 * are recovered by walking both sides in step: the lines a hunk does not cover
 * are unchanged by definition, and unchanged lines advance both sides equally.
 *
 * `head_line_count` is what bounds the final gap; without it there is no way to
 * know whether anything follows the last hunk, so a null leaves it off.
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

/** Drops the `@@ ... @@` numbers, leaving the enclosing context git found, if any. */
export const hunkSectionHeading = (header: string): string =>
  header.replace(/^@@ [^@]* @@/, '').trim()

/** The part of a run that starts `offset` lines in and continues for `length`. */
export const gapSlice = (gap: DiffGap, offset: number, length: number): DiffGap => ({
  base_start: gap.base_start + offset,
  head_start: gap.head_start + offset,
  length,
})

/**
 * A run's hidden lines, as the context rows the diff would have held.
 *
 * Read off the head, because a run is unchanged by definition and so both
 * sides carry the same text — while only the head is still on disk.
 */
export const gapLines = (gap: DiffGap, head_lines: readonly string[]): DiffLine[] =>
  Array.from({ length: gap.length }, (_unused, index) => ({
    kind: 'context' as const,
    base_line: gap.base_start + index,
    head_line: gap.head_start + index,
    text: head_lines[gap.head_start + index - 1] ?? '',
  }))
