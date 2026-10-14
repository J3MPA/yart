/**
 * Divides content into lines.
 *
 * A newline at the end closes the last line. It does not start an empty line.
 * Thus `"a\nb\n"` and `"a\nb"` both give two lines. Without this rule, each
 * file that ends with a newline would get an empty last line, and anchors could
 * point to it.
 */
export const splitLines = (content: string): string[] => {
  if (content === '') return []
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
