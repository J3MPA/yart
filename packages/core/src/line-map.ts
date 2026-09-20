import { diffLines } from 'diff';

export interface LineMapOptions {
  /**
   * Treat lines that differ only in leading/trailing whitespace as unchanged.
   *
   * Defaults to `true`: agents reformat constantly, and a reindent that
   * outdated every thread in the file would make review unusable.
   */
  ignore_whitespace?: boolean;
}

/**
 * jsdiff compares a final line that lacks a newline against one that has it as
 * a change, which would outdate threads on the last line of any file not ending
 * in a newline. Both sides get a terminator so that comparison is like-for-like;
 * `splitLines` discards it again, so numbering is unaffected.
 */
const withTrailingNewline = (content: string): string => {
  if (content === '' || content.endsWith('\n')) return content;
  return `${content}\n`;
};

/**
 * Maps line numbers from `before` to their counterparts in `after`.
 *
 * Only surviving lines appear. A line that was deleted — or modified, which a
 * line diff reports as a deletion plus an insertion — is absent, which is what
 * marks a thread on it as outdated.
 *
 * Both sides are 1-based.
 */
export const buildLineMap = (
  before: string,
  after: string,
  options: LineMapOptions = {},
): Map<number, number> => {
  const { ignore_whitespace = true } = options;
  const map = new Map<number, number>();

  let before_line = 1;
  let after_line = 1;

  const parts = diffLines(withTrailingNewline(before), withTrailingNewline(after), {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- jsdiff's option name
    ignoreWhitespace: ignore_whitespace,
  });

  for (const part of parts) {
    const count = part.count ?? 0;
    if (part.added) {
      after_line += count;
    } else if (part.removed) {
      before_line += count;
    } else {
      for (let offset = 0; offset < count; offset += 1) {
        map.set(before_line + offset, after_line + offset);
      }
      before_line += count;
      after_line += count;
    }
  }

  return map;
};
