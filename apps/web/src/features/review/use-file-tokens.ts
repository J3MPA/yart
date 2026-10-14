import { useEffect, useState } from 'react'
import type { DiffLine, FileContents } from '@yart/core'
import { languageFor, tokenize, type FileTokens, type SyntaxToken } from './syntax'

export interface SideTokens {
  base: FileTokens | null
  head: FileTokens | null
}

const NONE: SideTokens = { base: null, head: null }

/**
 * The two sides of a file as tokens, after the content of the file comes.
 *
 * Full files, not the lines of the diff, because the color of a line depends on
 * the lines before it. Otherwise the middle of a block comment shows as code.
 * The diff holds only the lines that changed.
 */
export const useFileTokens = (path: string, contents: FileContents | undefined): SideTokens => {
  const [tokens, setTokens] = useState<SideTokens>(NONE)

  useEffect(() => {
    const language =
      contents === undefined
        ? null
        : languageFor(path, contents.head_content ?? contents.base_content)
    if (contents === undefined || language === null) {
      setTokens(NONE)
      return
    }
    let current = true
    const side = (content: string | null) =>
      content === null ? Promise.resolve(null) : tokenize(content, language)
    void Promise.all([side(contents.base_content), side(contents.head_content)]).then(
      ([base, head]) => {
        if (current) setTokens({ base, head })
      },
    )
    return () => {
      current = false
    }
  }, [path, contents])

  return tokens
}

/**
 * The tokens for one row. A removed line takes them from the base, and all other
 * lines from the head.
 *
 * Null if they do not spell out exactly the text of the row. Thus a file with
 * different line endings, or a file that changed after the diff, shows plain
 * text. It does not show the wrong colors, or the wrong words.
 */
export const tokensForLine = (
  tokens: SideTokens,
  line: DiffLine,
): readonly SyntaxToken[] | null => {
  const removed = line.kind === 'removed'
  const lines = removed ? tokens.base : tokens.head
  const number = removed ? line.base_line : line.head_line
  if (lines === null || number === null) return null
  const found = lines[number - 1]
  if (found === undefined) return null
  return found.map((token) => token.content).join('') === line.text ? found : null
}
