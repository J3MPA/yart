import { describe, expect, it } from 'vitest'
import { languageFor, mayHighlight, tokenize } from './syntax'

describe('languageFor', () => {
  it('reads the language from the extension', () => {
    expect(languageFor('apps/web/src/app.tsx')).toBe('tsx')
    expect(languageFor('packages/core/src/index.ts')).toBe('ts')
    expect(languageFor('apps/desktop/src/preload.cjs')).toBe('cjs')
    expect(languageFor('README.md')).toBe('md')
  })

  it('knows files named for what they are', () => {
    expect(languageFor('Dockerfile')).toBe('dockerfile')
    expect(languageFor('build/Makefile')).toBe('make')
  })

  it('reads a script without an extension from its first line', () => {
    expect(languageFor('apps/desktop/bin/yart', '#!/bin/sh\nset -e\n')).toBe('sh')
    expect(languageFor('bin/tool', '#!/usr/bin/env node\n')).toBe('js')
    expect(languageFor('cli', '#!/usr/bin/env -S node --experimental-strip-types\n')).toBe('js')
    expect(languageFor('run', '#!/usr/bin/env python3\n')).toBe('py')
    expect(languageFor('notes', 'just some words\n')).toBeNull()
  })

  it('goes by the extension when there is one, whatever the first line says', () => {
    expect(languageFor('cli.ts', '#!/usr/bin/env node\n')).toBe('ts')
  })

  it('fetches a file to colour only when it may have a grammar', () => {
    expect(mayHighlight('src/app.tsx')).toBe(true)
    expect(mayHighlight('bin/yart')).toBe(true)
    expect(mayHighlight('assets/logo.weird')).toBe(false)
  })

  it('has nothing for files without a grammar', () => {
    expect(languageFor('LICENSE')).toBeNull()
    expect(languageFor('.gitignore')).toBeNull()
    expect(languageFor('assets/logo.weird')).toBeNull()
  })
})

describe('tokenize', () => {
  it('gives every line of the file its tokens, in order', async () => {
    const tokens = await tokenize('const a = 1\n// done\n', 'ts')
    expect(tokens).not.toBeNull()
    expect(tokens?.[0]?.map((token) => token.content).join('')).toBe('const a = 1')
    expect(tokens?.[1]?.map((token) => token.content).join('')).toBe('// done')
  })

  it('colours a line by what came before it, not by the line alone', async () => {
    const tokens = await tokenize('/*\nstill a comment\n*/\n', 'ts')
    expect(tokens?.[1]?.[0]?.color).toBe('var(--yart-syntax-token-comment)')
  })

  it('leaves a very large file plain', async () => {
    expect(await tokenize('x'.repeat(300 * 1024), 'ts')).toBeNull()
  })
})
