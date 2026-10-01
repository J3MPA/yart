import { describe, expect, it } from 'vitest'
import type { DiffLine } from '@yart/core'
import type { SyntaxToken } from './syntax'
import { tokensForLine, type SideTokens } from './use-file-tokens'

const token = (content: string): SyntaxToken => ({
  content,
  color: null,
  italic: false,
  bold: false,
})

const TOKENS: SideTokens = {
  base: [[token('old '), token('one')], [token('old two')]],
  head: [[token('new one')], [token('new '), token('two')]],
}

const line = (overrides: Partial<DiffLine>): DiffLine => ({
  kind: 'context',
  base_line: null,
  head_line: null,
  text: '',
  ...overrides,
})

describe('tokensForLine', () => {
  it('reads a removed line from the base', () => {
    const found = tokensForLine(TOKENS, line({ kind: 'removed', base_line: 1, text: 'old one' }))
    expect(found?.map((t) => t.content)).toEqual(['old ', 'one'])
  })

  it('reads added and unchanged lines from the head', () => {
    expect(
      tokensForLine(TOKENS, line({ kind: 'added', head_line: 2, text: 'new two' })),
    ).toHaveLength(2)
    expect(
      tokensForLine(TOKENS, line({ kind: 'context', base_line: 2, head_line: 1, text: 'new one' })),
    ).toHaveLength(1)
  })

  it('gives nothing when the tokens do not spell out the row', () => {
    expect(
      tokensForLine(TOKENS, line({ kind: 'added', head_line: 1, text: 'new one\r' })),
    ).toBeNull()
  })

  it('gives nothing for a line past the end, or before anything is tokenized', () => {
    expect(tokensForLine(TOKENS, line({ kind: 'added', head_line: 9, text: 'x' }))).toBeNull()
    expect(
      tokensForLine({ base: null, head: null }, line({ kind: 'added', head_line: 1, text: 'x' })),
    ).toBeNull()
  })
})
