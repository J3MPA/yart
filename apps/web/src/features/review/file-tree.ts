/**
 * A changed file, or a directory that holds changed files.
 *
 * `path` is the full path in the two cases. Thus a node identifies itself
 * without its parents. The sidebar needs this to find the diff of a file. A
 * folded directory needs it to stay addressable.
 */
export type TreeNode =
  | { kind: 'directory'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; path: string }

interface Building {
  name: string
  path: string
  directories: Map<string, Building>
  files: string[]
}

const emptyDirectory = (name: string, path: string): Building => ({
  name,
  path,
  directories: new Map(),
  files: [],
})

/**
 * Makes a subtree smaller. A directory that holds only one directory becomes one
 * row with that child.
 *
 * As four nested rows, `apps/web/src/features` gives four indents with no
 * information. As one row, it is one place to click. For this reason, a node
 * keeps a full path, not one segment. A folded name covers many levels, and
 * only the path still tells where it is.
 */
const foldChain = (node: Building): Building => {
  const compacted = emptyDirectory(node.name, node.path)
  compacted.files = node.files
  for (const child of node.directories.values()) {
    const folded = foldChain(child)
    compacted.directories.set(folded.name, folded)
  }

  const children = [...compacted.directories.values()]
  if (compacted.files.length === 0 && children.length === 1) {
    const only = children[0] as Building
    return { ...only, name: `${compacted.name}/${only.name}` }
  }
  return compacted
}

const byName = (left: { name: string }, right: { name: string }): number =>
  left.name.localeCompare(right.name)

/** Directories first, then files, each in alphabetical order. This is the shape of a file tree. */
const finish = (node: Building): TreeNode[] => [
  ...[...node.directories.values()]
    .map((child): TreeNode => ({
      kind: 'directory',
      name: child.name,
      path: child.path,
      children: finish(child),
    }))
    .sort(byName),
  ...node.files
    .map((path): TreeNode => ({ kind: 'file', name: path.slice(path.lastIndexOf('/') + 1), path }))
    .sort(byName),
]

/** Puts changed paths into a tree. A chain of directories with one child each becomes one row. */
export const buildFileTree = (paths: readonly string[]): TreeNode[] => {
  const root = emptyDirectory('', '')

  for (const path of paths) {
    const segments = path.split('/')
    const file_name = segments.pop()
    if (file_name === undefined || file_name === '') continue

    let node = root
    let prefix = ''
    for (const segment of segments) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`
      const existing = node.directories.get(segment)
      if (existing === undefined) {
        const created = emptyDirectory(segment, prefix)
        node.directories.set(segment, created)
        node = created
      } else {
        node = existing
      }
    }
    node.files.push(path)
  }

  // The root never folds. It has no name to fold into. A tree whose top row is
  // the full repository has one row that tells nothing.
  const folded = emptyDirectory('', '')
  folded.files = root.files
  for (const child of root.directories.values()) {
    const node = foldChain(child)
    folded.directories.set(node.name, node)
  }

  return finish(folded)
}

/** The files of the tree, in the order that the tree shows them. */
export const flattenFileTree = (nodes: readonly TreeNode[]): string[] =>
  nodes.flatMap((node) => (node.kind === 'file' ? [node.path] : flattenFileTree(node.children)))

/**
 * Puts the changed files in the same order as the tree.
 *
 * You find a file with the tree. Thus the diffs below must have the same order.
 * With two orders of one list, the index and the content disagree about what
 * comes next. Then you cannot find a file when you scroll.
 */
export const orderFilesByTree = <Item extends { path: string }>(items: readonly Item[]): Item[] => {
  const order = new Map(
    flattenFileTree(buildFileTree(items.map((item) => item.path))).map((path, index) => [
      path,
      index,
    ]),
  )
  return [...items].sort(
    (left, right) => (order.get(left.path) ?? 0) - (order.get(right.path) ?? 0),
  )
}
