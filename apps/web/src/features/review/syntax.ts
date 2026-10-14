import type { HighlighterCore, ThemedToken } from 'shiki/core'
import { bundledLanguages, type BundledLanguage } from 'shiki/langs'

/** One run of text in a line, with one color. */
export interface SyntaxToken {
  content: string
  /** A CSS color, `var(--yart-syntax-…)`, or null to use the text color. */
  color: string | null
  italic: boolean
  bold: boolean
}

/** The lines of a file as tokens. The index starts at zero: line 1 is `lines[0]`. */
export type FileTokens = readonly (readonly SyntaxToken[])[]

/**
 * A file larger than this shows as plain text. The tokens are made on the main
 * thread. Nobody reads a generated or vendored file of this size line by line.
 */
export const MAX_HIGHLIGHT_BYTES = 256 * 1024

/** Full file names that tell the type of a file, in the place of an extension. */
const BY_NAME: Readonly<Record<string, BundledLanguage>> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
}

/** Interpreters that a script names on its first line, when they are not the name of a grammar. */
const BY_INTERPRETER: Readonly<Record<string, BundledLanguage>> = {
  bash: 'sh',
  zsh: 'sh',
  node: 'js',
  python3: 'py',
}

const baseName = (path: string): string => (path.split('/').pop() ?? '').toLowerCase()

const hasExtension = (name: string): boolean => name.lastIndexOf('.') > 0

/** `#!/bin/sh`, `#!/usr/bin/env node`, `#!/usr/bin/env -S node --flag` */
const SHEBANG = /^#!\s*(?:\S*\/env\s+(?:-S\s+)?)?(?:\S*\/)?(\S+)/

/**
 * The grammar for a file, or null when no grammar is useful. For a file without
 * an extension, such as a script in `bin/`, the first line tells the grammar.
 */
export const languageFor = (
  path: string,
  content: string | null = null,
): BundledLanguage | null => {
  const name = baseName(path)
  const by_name = BY_NAME[name]
  if (by_name !== undefined) return by_name
  if (hasExtension(name)) {
    const extension = name.slice(name.lastIndexOf('.') + 1)
    return extension in bundledLanguages ? (extension as BundledLanguage) : null
  }
  const interpreter = content === null ? undefined : SHEBANG.exec(content)?.[1]
  if (interpreter === undefined) return null
  const language = BY_INTERPRETER[interpreter] ?? interpreter
  return language in bundledLanguages ? (language as BundledLanguage) : null
}

/**
 * Tells if a file is worth a request to color it. Its name gives a grammar, or
 * it has no extension and its first line can name a grammar.
 */
export const mayHighlight = (path: string): boolean =>
  languageFor(path) !== null || !hasExtension(baseName(path))

let highlighter: Promise<HighlighterCore> | null = null

/**
 * One highlighter for the page. Grammars come when files need them. Each grammar
 * is its own chunk. Thus a review downloads only the languages that it has. The
 * highlighter loads when the first file gets color. Thus a page that colors
 * nothing never loads it. The JavaScript regex engine prevents the load of the
 * WebAssembly engine.
 */
const getHighlighter = (): Promise<HighlighterCore> => {
  highlighter ??= (async () => {
    const [{ createCssVariablesTheme, createHighlighterCore }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/core'), import('shiki/engine/javascript')])
    return createHighlighterCore({
      // The colors come as CSS variables, not from a theme of the highlighter.
      // Thus `tokens.css` sets them for the two color schemes, as it does for
      // all other colors in the interface.
      themes: [
        createCssVariablesTheme({
          name: 'yart',
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Shiki's option name
          variablePrefix: '--yart-syntax-',
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Shiki's option name
          fontStyle: true,
        }),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return highlighter
}

// The FontStyle flags of Shiki. Its types give them only as a const enum.
const ITALIC = 1
const BOLD = 2

const toToken = (token: ThemedToken): SyntaxToken => {
  const style = token.fontStyle ?? 0
  return {
    content: token.content,
    color: token.color ?? null,
    italic: (style & ITALIC) !== 0,
    bold: (style & BOLD) !== 0,
  }
}

/** The tokens for a full file, or null when the file gets no highlights. */
export const tokenize = async (
  content: string,
  language: BundledLanguage,
): Promise<FileTokens | null> => {
  if (content.length > MAX_HIGHLIGHT_BYTES) return null
  const instance = await getHighlighter()
  if (!instance.getLoadedLanguages().includes(language)) {
    await instance.loadLanguage(bundledLanguages[language])
  }
  return instance
    .codeToTokensBase(content, { lang: language, theme: 'yart' })
    .map((line) => line.map(toToken))
}
