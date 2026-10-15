import { bundledLanguages, type BundledLanguage } from 'shiki/langs'

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])

/**
 * The address of a link in a comment, or null when the link must not open.
 *
 * Only absolute http, https and mailto addresses pass. A relative address goes
 * to the daemon, and a `javascript:` address runs code. The result is the
 * address as the browser parses it. Thus the browser opens the address that
 * this check examined.
 */
export const safeHref = (url: string): string | null => {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  return LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : null
}

const LANGUAGE_CLASS = /^language-(.+)$/

/**
 * The grammar of a fenced code block, from the classes of its `code` element.
 * Null when the block names no language, or a language that Shiki does not know.
 */
export const fenceLanguage = (class_names: readonly string[]): BundledLanguage | null => {
  for (const class_name of class_names) {
    const language = LANGUAGE_CLASS.exec(class_name)?.[1]?.toLowerCase()
    if (language !== undefined && Object.hasOwn(bundledLanguages, language)) {
      return language as BundledLanguage
    }
  }
  return null
}

/** The text of a fenced code block, without the line break that ends the block. */
export const fenceText = (text: string): string => text.replace(/\r?\n$/, '')
