/**
 * A changed file, or a directory holding them.
 *
 * `path` is the full path in both cases, so a node identifies itself without
 * reference to its parents — which is what the sidebar needs in order to look
 * a file's diff up, and what a folded directory needs to stay addressable.
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
 * Compacts a subtree, folding a directory that holds nothing but one directory
 * into that child.
 *
 * `apps/web/src/features` as four nested rows is four levels of indentation
 * carrying no information; as one row it is a single place to click. This is
 * why a node keeps a full path rather than one segment: a folded name spans
 * several levels, and only the path still says where it is.
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

/** Directories first, then files, each alphabetical — the shape a file tree has. */
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

/** Arranges changed paths into a tree, folding single-child directory chains. */
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

  // The root is never folded: it has no name to fold into, and a tree whose
  // top row is the whole repository is one row of nothing.
  const folded = emptyDirectory('', '')
  folded.files = root.files
  for (const child of root.directories.values()) {
    const node = foldChain(child)
    folded.directories.set(node.name, node)
  }

  return finish(folded)
}

/** The tree's files, in the order it presents them. */
export const flattenFileTree = (nodes: readonly TreeNode[]): string[] =>
  nodes.flatMap((node) => (node.kind === 'file' ? [node.path] : flattenFileTree(node.children)))

/**
 * Reorders changed files to match the tree drawn from them.
 *
 * The tree is how a file is found, so the diffs below have to run in the same
 * order: two orderings of one list leave the index and the contents disagreeing
 * about what comes next, and scrolling stops being a way of getting anywhere.
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
