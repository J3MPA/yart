/** Where a file's section sits relative to the top of the window. */
export interface FilePosition {
  path: string
  /** Distance from the top of the viewport, as `getBoundingClientRect` gives it. */
  top: number
}

/**
 * How far down the window the reading line sits, as a fraction of its height.
 *
 * Not the very top: the file being read is the one filling the screen, not the
 * one whose last rows are scrolling out of it.
 */
export const READING_LINE = 0.25

/**
 * Which file is being read, given where each one starts.
 *
 * The last file to have begun above the reading line — everything below it has
 * not been reached yet. Positions must be in the order they appear on the page.
 *
 * Before the first file has crossed the line there is still a file on screen,
 * so the first one is named rather than nothing: an index that highlights
 * nothing at the top of the page reads as broken rather than as precise.
 */
export const activeFile = (
  positions: readonly FilePosition[],
  reading_line: number,
): string | null => {
  let current = positions[0]?.path ?? null
  for (const position of positions) {
    if (position.top > reading_line) break
    current = position.path
  }
  return current
}
