import { diffLines } from 'diff'

export interface LineMapOptions {
  /**
   * Treat two lines as unchanged when only the whitespace at their start or end
   * is different.
   *
   * The default is `true`. Agents change the format frequently. If a new indent
   * made all threads in the file outdated, review would not be possible.
   */
  ignore_whitespace?: boolean
}

/**
 * jsdiff sees a last line without a newline and the same line with a newline as
 * a change. Thus threads on the last line of a file without a final newline
 * would become outdated. This function gives the two sides a newline, thus they
 * compare correctly. `splitLines` removes the newline again, thus the line
 * numbers do not change.
 */
const withTrailingNewline = (content: string): string => {
  if (content === '' || content.endsWith('\n')) return content
  return `${content}\n`
}

/**
 * Maps the line numbers in `before` to the same lines in `after`.
 *
 * Only lines that stay are in the map. A deleted line is not in the map. A
 * changed line is also not in the map, because a line diff shows a change as a
 * deletion and an addition. A line that is not in the map makes its thread
 * outdated.
 *
 * The two sides start at line 1.
 */
export const buildLineMap = (
  before: string,
  after: string,
  options: LineMapOptions = {},
): Map<number, number> => {
  const { ignore_whitespace = true } = options
  const map = new Map<number, number>()

  let before_line = 1
  let after_line = 1

  const parts = diffLines(withTrailingNewline(before), withTrailingNewline(after), {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- jsdiff's option name
    ignoreWhitespace: ignore_whitespace,
  })

  for (const part of parts) {
    const count = part.count ?? 0
    if (part.added) {
      after_line += count
    } else if (part.removed) {
      before_line += count
    } else {
      for (let offset = 0; offset < count; offset += 1) {
        map.set(before_line + offset, after_line + offset)
      }
      before_line += count
      after_line += count
    }
  }

  return map
}
