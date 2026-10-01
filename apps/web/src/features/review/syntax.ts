import type { HighlighterCore, ThemedToken } from 'shiki/core'
import { bundledLanguages, type BundledLanguage } from 'shiki/langs'

/** One coloured run of text within a line. */
export interface SyntaxToken {
  content: string
  /** A CSS colour, `var(--yart-syntax-…)`, or null to inherit the text colour. */
  color: string | null
  italic: boolean
  bold: boolean
}

/** A file's lines as tokens, indexed from zero: line 1 is `lines[0]`. */
export type FileTokens = readonly (readonly SyntaxToken[])[]

/**
 * Beyond this a file is shown plain. Tokenizing runs on the main thread, and a
 * generated or vendored file of this size is not one anyone reads line by line.
 */
export const MAX_HIGHLIGHT_BYTES = 256 * 1024

/** Whole file names that say what a file is where an extension would. */
const BY_NAME: Readonly<Record<string, BundledLanguage>> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
}

/** Interpreters a script names on its first line, where they are not a grammar's name. */
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
 * The grammar for a file, or null for one with none worth loading. A file with
 * no extension, such as a script in `bin/`, is read from its first line.
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
 * Whether a file is worth fetching to colour: it has a grammar by its name, or
 * it has no extension and its first line may name one.
 */
export const mayHighlight = (path: string): boolean =>
  languageFor(path) !== null || !hasExtension(baseName(path))

let highlighter: Promise<HighlighterCore> | null = null

/**
 * One highlighter for the page, with grammars added as files need them: each
 * grammar is its own chunk, so a review downloads only the languages it has.
 * The highlighter itself is loaded the first time a file is coloured, so a page
 * that colours nothing never pays for it, and the JavaScript regex engine spares
 * loading the WebAssembly one.
 */
const getHighlighter = (): Promise<HighlighterCore> => {
  highlighter ??= (async () => {
    const [{ createCssVariablesTheme, createHighlighterCore }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/core'), import('shiki/engine/javascript')])
    return createHighlighterCore({
      // Colours come out as CSS variables rather than a highlighter's own
      // theme, so that `tokens.css` decides them for both colour schemes like
      // every other colour in the interface.
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

// Shiki's FontStyle flags, which its types expose only as a const enum.
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

/** Tokens for a whole file, or null when it is not one to highlight. */
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
