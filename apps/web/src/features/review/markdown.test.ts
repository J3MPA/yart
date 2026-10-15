import { describe, expect, it } from 'vitest'
import { fenceLanguage, fenceText, safeHref } from './markdown'

describe('safeHref', () => {
  it('keeps http, https and mailto addresses', () => {
    expect(safeHref('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d')
    expect(safeHref('http://example.com')).toBe('http://example.com/')
    expect(safeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com')
    expect(safeHref('HTTPS://Example.com')).toBe('https://example.com/')
  })

  it('refuses addresses that run code or load data', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref(' javascript:alert(1)')).toBeNull()
    expect(safeHref('java\tscript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeHref('vbscript:msgbox(1)')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
  })

  it('refuses relative addresses and text that is not an address', () => {
    expect(safeHref('/api/reviews')).toBeNull()
    expect(safeHref('#top')).toBeNull()
    expect(safeHref('example.com')).toBeNull()
    expect(safeHref('')).toBeNull()
  })
})

describe('fenceLanguage', () => {
  it('reads the language from the class of the code element', () => {
    expect(fenceLanguage(['language-ts'])).toBe('ts')
    expect(fenceLanguage(['language-TypeScript'])).toBe('typescript')
    expect(fenceLanguage(['other', 'language-json'])).toBe('json')
  })

  it('gives null when the block names no language that Shiki knows', () => {
    expect(fenceLanguage([])).toBeNull()
    expect(fenceLanguage(['language-text'])).toBeNull()
    expect(fenceLanguage(['language-nonsense'])).toBeNull()
    expect(fenceLanguage(['language-constructor'])).toBeNull()
    expect(fenceLanguage(['ts'])).toBeNull()
  })
})

describe('fenceText', () => {
  it('removes the line break that ends the block', () => {
    expect(fenceText('const a = 1\n')).toBe('const a = 1')
    expect(fenceText('a\n\n')).toBe('a\n')
    expect(fenceText('a\r\n')).toBe('a')
    expect(fenceText('a')).toBe('a')
  })
})
