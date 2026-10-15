import { useEffect, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import type { BundledLanguage } from 'shiki/langs'
import { fenceLanguage, fenceText, safeHref } from './markdown'
import { tokenize, tokenStyle, type FileTokens } from './syntax'
import styles from './markdown-body.module.css'

/**
 * The elements that a comment can make. All other elements show only their
 * content. Raw HTML in the text shows as text, because react-markdown does not
 * parse it without `rehype-raw`.
 */
const ALLOWED_ELEMENTS: readonly string[] = [
  'p',
  'br',
  'em',
  'strong',
  'code',
  'pre',
  'a',
  'img',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
]

const useCodeTokens = (code: string, language: BundledLanguage | null): FileTokens | null => {
  const [tokens, setTokens] = useState<FileTokens | null>(null)

  useEffect(() => {
    setTokens(null)
    if (language === null) return
    let current = true
    void tokenize(code, language)
      .then((result) => {
        if (current) setTokens(result)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [code, language])

  return tokens
}

interface CodeBlockProps {
  code: string
  language: BundledLanguage | null
}

/**
 * A fenced code block. It shows plain text until the colors come, and when
 * Shiki does not know the language.
 */
const CodeBlock = ({ code, language }: CodeBlockProps) => {
  const tokens = useCodeTokens(code, language)
  return (
    <pre className={styles.code_block}>
      <code>
        {tokens === null
          ? code
          : tokens.map((line, line_index) => (
              <span key={line_index}>
                {line_index > 0 && '\n'}
                {line.map((token, index) => (
                  <span key={index} style={tokenStyle(token)}>
                    {token.content}
                  </span>
                ))}
              </span>
            ))}
      </code>
    </pre>
  )
}

const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href === undefined || href === '' ? (
      <span>{children}</span>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
  // An image from a comment does not load. A request to a different host can
  // tell that host who reads the review. The image shows as a link.
  img: ({ src, alt }) => {
    const label = alt === undefined || alt === '' ? src : alt
    return typeof src === 'string' && src !== '' ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      <span>{alt}</span>
    )
  },
  pre: ({ node }) => {
    const code = node?.children[0]
    if (code?.type !== 'element' || code.tagName !== 'code') return null
    const class_names = code.properties.className
    const text = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
    return (
      <CodeBlock
        code={fenceText(text)}
        language={fenceLanguage(Array.isArray(class_names) ? class_names.map(String) : [])}
      />
    )
  },
}

const urlTransform = (url: string): string => safeHref(url) ?? ''

export interface MarkdownRenderProps {
  text: string
}

export const MarkdownRender = ({ text }: MarkdownRenderProps) => (
  <Markdown
    allowedElements={ALLOWED_ELEMENTS}
    unwrapDisallowed
    components={COMPONENTS}
    urlTransform={urlTransform}
  >
    {text}
  </Markdown>
)
