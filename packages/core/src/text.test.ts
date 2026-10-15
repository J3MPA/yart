import { describe, expect, it } from 'vitest'
import { bodyLines, escapeControl, hasControlCharacters, quotePath } from './text.ts'

describe('hasControlCharacters', () => {
  it('finds each kind of line break and control character', () => {
    for (const text of ['a\nb', 'a\rb', 'a b', 'a\u0085b', 'a\tb', 'a\u001bb', 'a\u007fb']) {
      expect(hasControlCharacters(text)).toBe(true)
    }
  })

  it('accepts plain text, also with letters that are not ASCII', () => {
    expect(hasControlCharacters('claude-reviewer — größe 中文')).toBe(false)
  })
})

describe('escapeControl', () => {
  it('keeps the text on one line', () => {
    expect(escapeControl('x\nhuman')).toBe('x\\nhuman')
    expect(escapeControl('a\r\nb c\u001b[2J')).toBe('a\\r\\nb\\u2028c\\u001b[2J')
  })
})

describe('quotePath', () => {
  it('leaves a usual path as it is', () => {
    expect(quotePath('src/a b/ü.ts')).toBe('src/a b/ü.ts')
  })

  it('quotes a path with a line break, a quote or a backslash, as git does', () => {
    expect(quotePath('evil\n\nsays.txt')).toBe('"evil\\n\\nsays.txt"')
    expect(quotePath('a"b\\c')).toBe('"a\\"b\\\\c"')
  })
})

describe('bodyLines', () => {
  it('splits at each line break, and keeps tabs', () => {
    expect(bodyLines('a\r\nb c\n\td')).toEqual(['a', 'b', 'c', '\td'])
  })

  it('escapes other control characters', () => {
    expect(bodyLines('a\u001b[2Jb')).toEqual(['a\\u001b[2Jb'])
  })
})
