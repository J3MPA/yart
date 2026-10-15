/**
 * Text that a party with less trust wrote goes into the text that an agent or a
 * terminal reads. A line break in such text could start a line that looks like
 * a line of yart, for example a comment of the person. These functions make such
 * text safe to show.
 */

/**
 * The characters that start a new line for a reader. A model can read a line
 * separator or a next-line character as a line break, thus they count too.
 */
const LINE_BREAK = '\\r\\n|[\\n\\r\\v\\f\\u0085\\u2028\\u2029]'

/** Control characters other than the line breaks. The tab is one of them. */
const CONTROL = '[\\u0000-\\u0009\\u000e-\\u001f\\u007f-\\u0084\\u0086-\\u009f]'

const ESCAPES: Record<string, string> = {
  '\r\n': '\\r\\n',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\v': '\\v',
  '\f': '\\f',
  '"': '\\"',
  '\\': '\\\\',
}

const escapeOne = (character: string): string =>
  ESCAPES[character] ?? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`

/** Tells if a text has a line break or a control character. A name or a title must not. */
export const hasControlCharacters = (text: string): boolean =>
  new RegExp(`${LINE_BREAK}|${CONTROL}`).test(text)

/**
 * Shows each control character and line break as an escape, for text that must
 * stay on one line, such as a name or a title.
 */
export const escapeControl = (text: string): string =>
  text.replace(new RegExp(`${LINE_BREAK}|${CONTROL}`, 'g'), escapeOne)

/**
 * A file path in the form that git gives with `core.quotePath`. A path with a
 * quote, a backslash or a control character gets quotes and escapes. Other
 * paths stay as they are, thus the common case is easy to read.
 */
export const quotePath = (path: string): string => {
  const unsafe = new RegExp(`${LINE_BREAK}|${CONTROL}|["\\\\]`, 'g')
  return unsafe.test(path) ? `"${path.replace(unsafe, escapeOne)}"` : path
}

/**
 * The lines of a body of text. Each control character in a line becomes an
 * escape. The tab stays, because code in a comment uses it.
 */
export const bodyLines = (body: string): string[] =>
  body
    .split(new RegExp(LINE_BREAK))
    .map((line) =>
      line.replace(new RegExp(CONTROL, 'g'), (character) =>
        character === '\t' ? character : escapeOne(character),
      ),
    )
