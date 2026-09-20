import { splitLines } from './lines.ts';
import type { AnchorContext } from './types.ts';

export const DEFAULT_CONTEXT_RADIUS = 3;

/**
 * Captures the text around a line so a thread stays readable after its anchor
 * dies. Near the start or end of a file the returned arrays are simply shorter.
 *
 * @param line 1-based.
 * @throws RangeError if `line` is outside `content`.
 */
export const captureContext = (
  content: string,
  line: number,
  radius: number = DEFAULT_CONTEXT_RADIUS,
): AnchorContext => {
  const lines = splitLines(content);
  const index = line - 1;
  const target = lines[index];

  if (target === undefined) {
    throw new RangeError(
      `Line ${line} is out of range: content has ${lines.length} line(s).`,
    );
  }

  return {
    before: lines.slice(Math.max(0, index - radius), index),
    line: target,
    after: lines.slice(index + 1, index + 1 + radius),
  };
};
