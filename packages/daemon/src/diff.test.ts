import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildFileDiff, parseUnifiedDiff } from './diff.ts'
import { listChangedFiles } from './git.ts'
import { TestRepo } from './test-repo.ts'
import type { ReviewFile } from './types.ts'

const FOUR_LINES = 'alpha\nbeta\ngamma\ndelta\n'

let repo: TestRepo

beforeEach(() => {
  repo = new TestRepo()
})

afterEach(() => {
  repo.dispose()
})

/** Commits `before`, then `after`, and returns the diff of the file between them. */
const diffOf = async (before: string | null, after: string | null, path = 'a.txt') => {
  if (before !== null) repo.write(path, before)
  else repo.write('placeholder.txt', 'x\n')
  const base = repo.commit('base')

  if (after === null) repo.remove(path)
  else repo.write(path, after)
  const head = repo.commit('head')

  const changed = await listChangedFiles(repo.path, base, head)
  const file = changed.find((candidate) => candidate.path === path) as ReviewFile
  return buildFileDiff(repo.path, file)
}

describe('parseUnifiedDiff', () => {
  it('numbers context lines on both sides', () => {
    const [hunk] = parseUnifiedDiff('@@ -1,2 +1,2 @@\n alpha\n beta\n')
    expect(hunk?.lines).toEqual([
      { kind: 'context', base_line: 1, head_line: 1, text: 'alpha' },
      { kind: 'context', base_line: 2, head_line: 2, text: 'beta' },
    ])
  })

  it('numbers a removed line on the base side only', () => {
    const [hunk] = parseUnifiedDiff('@@ -1,1 +0,0 @@\n-gone\n')
    expect(hunk?.lines[0]).toEqual({
      kind: 'removed',
      base_line: 1,
      head_line: null,
      text: 'gone',
    })
  })

  it('numbers an added line on the head side only', () => {
    const [hunk] = parseUnifiedDiff('@@ -0,0 +1,1 @@\n+new\n')
    expect(hunk?.lines[0]).toEqual({ kind: 'added', base_line: null, head_line: 1, text: 'new' })
  })

  it('keeps the two sides in step across a replacement', () => {
    const [hunk] = parseUnifiedDiff('@@ -1,3 +1,3 @@\n a\n-old\n+new\n b\n')
    expect(hunk?.lines.map((line) => [line.kind, line.base_line, line.head_line])).toEqual([
      ['context', 1, 1],
      ['removed', 2, null],
      ['added', null, 2],
      ['context', 3, 3],
    ])
  })

  it('ignores the no-newline marker rather than treating it as a line', () => {
    const [hunk] = parseUnifiedDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n')
    expect(hunk?.lines.map((line) => line.text)).toEqual(['a', 'a'])
  })

  it('ignores the file headers git emits before the first hunk', () => {
    const output =
      'diff --git a/x b/x\nindex abc..def 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n'
    expect(parseUnifiedDiff(output)).toHaveLength(1)
  })

  it('reads several hunks with their own starting lines', () => {
    const hunks = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-a\n+A\n@@ -10,1 +10,1 @@\n-j\n+J\n')
    expect(hunks).toHaveLength(2)
    expect(hunks[1]?.lines[0]?.base_line).toBe(10)
  })

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

describe('buildFileDiff against a real repository', () => {
  it('produces a hunk for a modified file', async () => {
    const diff = await diffOf(FOUR_LINES, 'alpha\nCHANGED\ngamma\ndelta\n')
    const kinds = diff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.kind))
    expect(kinds).toContain('removed')
    expect(kinds).toContain('added')
    expect(diff.is_binary).toBe(false)
  })

  it('numbers the changed line so it matches what an anchor would use', async () => {
    const diff = await diffOf(FOUR_LINES, 'alpha\nCHANGED\ngamma\ndelta\n')
    const added = diff.hunks.flatMap((hunk) => hunk.lines).find((line) => line.kind === 'added')
    expect(added).toMatchObject({ head_line: 2, text: 'CHANGED' })
  })

  it('marks every line of an added file as added', async () => {
    const diff = await diffOf(null, 'one\ntwo\n')
    const lines = diff.hunks.flatMap((hunk) => hunk.lines)
    expect(lines.map((line) => [line.kind, line.head_line, line.text])).toEqual([
      ['added', 1, 'one'],
      ['added', 2, 'two'],
    ])
  })

  it('marks every line of a deleted file as removed', async () => {
    const diff = await diffOf('one\ntwo\n', null)
    const lines = diff.hunks.flatMap((hunk) => hunk.lines)
    expect(lines.map((line) => [line.kind, line.base_line])).toEqual([
      ['removed', 1],
      ['removed', 2],
    ])
  })

  it('produces no hunks for an empty added file', async () => {
    const diff = await diffOf(null, '')
    expect(diff.hunks).toEqual([])
  })

  it('includes surrounding context but not the whole file', async () => {
    const many = `${Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')}\n`
    const changed = many.replace('line 10', 'LINE TEN')
    const diff = await diffOf(many, changed)
    const context = diff.hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.kind === 'context')
    expect(context.length).toBeGreaterThan(0)
    expect(context.some((line) => line.text === 'line 1')).toBe(false)
  })

  it('flags a binary file instead of trying to render it', async () => {
    const nul = String.fromCharCode(0)
    repo.write('a.bin', `${nul}${String.fromCharCode(1)}binary${nul}`)
    const base = repo.commit('base')
    repo.write('a.bin', `${nul}${String.fromCharCode(2)}different${nul}`)
    const head = repo.commit('head')

    const changed = await listChangedFiles(repo.path, base, head)
    const diff = await buildFileDiff(repo.path, changed[0] as ReviewFile)
    expect(diff.is_binary).toBe(true)
    expect(diff.hunks).toEqual([])
  })

  it('diffs a renamed file across its old and new path', async () => {
    repo.write('a.txt', FOUR_LINES)
    const base = repo.commit('base')
    repo.move('a.txt', 'b.txt')
    repo.write('b.txt', 'alpha\nCHANGED\ngamma\ndelta\n')
    const head = repo.commit('head')

    const changed = await listChangedFiles(repo.path, base, head)
    const diff = await buildFileDiff(repo.path, changed[0] as ReviewFile)
    expect(diff.old_path).toBe('a.txt')
    expect(diff.path).toBe('b.txt')
    expect(diff.hunks.flatMap((hunk) => hunk.lines).some((line) => line.text === 'CHANGED')).toBe(
      true,
    )
  })
})
