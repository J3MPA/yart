import { useEffect, useState } from 'react'
import type { DiffLine, FileContents } from '@yart/core'
import { languageFor, tokenize, type FileTokens, type SyntaxToken } from './syntax'

export interface SideTokens {
  base: FileTokens | null
  head: FileTokens | null
}

const NONE: SideTokens = { base: null, head: null }

/**
 * Both sides of a file as tokens, once its contents have arrived.
 *
 * Whole files rather than the diff's lines, because a line's colour depends on
 * what came before it — the middle of a block comment reads as code otherwise —
 * and the diff only holds the lines that changed.
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
 * The tokens for one row: a removed line is read from the base, anything else
 * from the head.
 *
 * Null unless they spell out exactly the row's text, so that a file read with
 * different line endings, or changed since the diff was taken, shows plain text
 * rather than the wrong colours — or worse, the wrong words.
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
