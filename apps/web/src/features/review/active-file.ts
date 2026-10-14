/** Where the section of a file is, relative to the top of the window. */
export interface FilePosition {
  path: string
  /** The distance from the top of the viewport, as `getBoundingClientRect` gives it. */
  top: number
}

/**
 * How far down the window the reading line is, as a fraction of its height.
 *
 * Not at the top. The file that you read is the file that fills the screen, not
 * the file whose last rows go out of it.
 */
export const READING_LINE = 0.25

/**
 * The file that you read, from where each file starts.
 *
 * This is the last file that starts above the reading line. You did not get to
 * the files below it yet. The positions must be in the order of the page.
 *
 * Before the first file crosses the line, a file is still on the screen. Thus
 * the function names the first file, not nothing. An index that marks nothing at
 * the top of the page looks broken, not precise.
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
