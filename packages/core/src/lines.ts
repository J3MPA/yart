/**
 * Splits content into lines.
 *
 * A trailing newline terminates the last line rather than starting an empty
 * one, so `"a\nb\n"` and `"a\nb"` both yield two lines. Without this, every
 * file ending in a newline would gain a phantom final line that anchors could
 * point at.
 */
export function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
