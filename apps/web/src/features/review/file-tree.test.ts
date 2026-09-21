import { describe, expect, it } from 'vitest'
import { buildFileTree, flattenFileTree, orderFilesByTree, type TreeNode } from './file-tree'

/** A readable shape to assert against: 'name' for a file, 'name/[...]' for a directory. */
const sketch = (nodes: readonly TreeNode[]): unknown[] =>
  nodes.map((node) => (node.kind === 'file' ? node.name : { [node.name]: sketch(node.children) }))

describe('buildFileTree', () => {
  it('puts files at the root at the root', () => {
    expect(sketch(buildFileTree(['README.md']))).toEqual(['README.md'])
  })

  it('folds a chain of single-child directories into one row', () => {
    expect(sketch(buildFileTree(['apps/web/src/app.tsx']))).toEqual([
      { 'apps/web/src': ['app.tsx'] },
    ])
  })

  it('stops folding where a directory branches', () => {
    expect(sketch(buildFileTree(['a/b/one.ts', 'a/c/two.ts']))).toEqual([
      { a: [{ b: ['one.ts'] }, { c: ['two.ts'] }] },
    ])
  })

  it('stops folding where a directory also holds a file', () => {
    expect(sketch(buildFileTree(['a/one.ts', 'a/b/two.ts']))).toEqual([
      { a: [{ b: ['two.ts'] }, 'one.ts'] },
    ])
  })

  it('keeps the full path on a folded directory', () => {
    const [node] = buildFileTree(['apps/web/src/app.tsx'])
    expect(node).toMatchObject({ kind: 'directory', name: 'apps/web/src', path: 'apps/web/src' })
  })

  it('keeps the full path on a file', () => {
    const [directory] = buildFileTree(['apps/web/app.tsx'])
    expect(directory?.kind === 'directory' && directory.children[0]).toMatchObject({
      kind: 'file',
      name: 'app.tsx',
      path: 'apps/web/app.tsx',
    })
  })

  it('sorts directories before files, each alphabetically', () => {
    expect(sketch(buildFileTree(['z.ts', 'a.ts', 'pkg/b.ts', 'lib/c.ts']))).toEqual([
      { lib: ['c.ts'] },
      { pkg: ['b.ts'] },
      'a.ts',
      'z.ts',
    ])
  })

  it('handles an empty review', () => {
    expect(buildFileTree([])).toEqual([])
  })
})

describe('orderFilesByTree', () => {
  it('puts the files in the order the tree draws them', () => {
    const files = [{ path: 'z.ts' }, { path: 'pkg/b.ts' }, { path: 'a.ts' }, { path: 'lib/c.ts' }]
    expect(orderFilesByTree(files).map((file) => file.path)).toEqual([
      'lib/c.ts',
      'pkg/b.ts',
      'a.ts',
      'z.ts',
    ])
  })

  it('agrees with the tree on a folded chain', () => {
    const paths = ['README.md', 'apps/web/src/app.tsx', 'apps/web/src/main.tsx']
    const ordered = orderFilesByTree(paths.map((path) => ({ path }))).map((file) => file.path)
    expect(ordered).toEqual(flattenFileTree(buildFileTree(paths)))
    expect(ordered).toEqual(['apps/web/src/app.tsx', 'apps/web/src/main.tsx', 'README.md'])
  })

  it('leaves an empty list alone', () => {
    expect(orderFilesByTree([])).toEqual([])
  })
})
