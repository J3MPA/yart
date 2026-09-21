import { useMemo } from 'react'
import type { FileDiff, Thread } from '@yart/core'
import { buildFileTree, type TreeNode } from './file-tree'
import { summarizeFiles, type FileSummary } from './file-summary'
import styles from './review.module.css'

export interface FileSidebarProps {
  files: readonly FileDiff[]
  threads: readonly Thread[]
  /** The file the page is currently showing, marked in the list. */
  active_path: string | null
  onSelect: (path: string) => void
}

const STATUS_LETTER: Record<FileDiff['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
}

interface TreeRowsProps {
  nodes: readonly TreeNode[]
  files: ReadonlyMap<string, FileDiff>
  summaries: ReadonlyMap<string, FileSummary>
  active_path: string | null
  onSelect: (path: string) => void
}

const TreeRows = ({ nodes, files, summaries, active_path, onSelect }: TreeRowsProps) => (
  <ul className={styles.tree_list}>
    {nodes.map((node) => {
      if (node.kind === 'directory') {
        return (
          <li key={node.path}>
            <div className={styles.tree_directory}>{node.name}</div>
            <TreeRows
              nodes={node.children}
              files={files}
              summaries={summaries}
              active_path={active_path}
              onSelect={onSelect}
            />
          </li>
        )
      }

      const file = files.get(node.path)
      const summary = summaries.get(node.path)

      return (
        <li key={node.path}>
          {/* A button rather than a fragment link: a path can hold characters
              a URL fragment would have to escape, and there is no router here
              to give the escaping a second home. */}
          <button
            type="button"
            className={[styles.tree_file, node.path === active_path ? styles.tree_file_active : '']
              .filter(Boolean)
              .join(' ')}
            title={node.path}
            aria-current={node.path === active_path ? 'true' : undefined}
            onClick={() => onSelect(node.path)}
          >
            <span className={styles.tree_status}>
              {file === undefined ? '' : STATUS_LETTER[file.status]}
            </span>
            <span className={styles.tree_name}>{node.name}</span>
            {summary !== undefined && summary.open_threads > 0 && (
              <span
                className={styles.tree_threads}
                title={`${summary.open_threads} open of ${summary.total_threads}`}
              >
                {summary.open_threads}
              </span>
            )}
            {summary !== undefined && (
              <span className={styles.tree_counts}>
                <span className={styles.tree_added}>+{summary.added}</span>{' '}
                <span className={styles.tree_removed}>-{summary.removed}</span>
              </span>
            )}
          </button>
        </li>
      )
    })}
  </ul>
)

/** The changed files of a review, as a tree, with what is waiting in each. */
export const FileSidebar = ({ files, threads, active_path, onSelect }: FileSidebarProps) => {
  const tree = useMemo(() => buildFileTree(files.map((file) => file.path)), [files])
  const summaries = useMemo(() => summarizeFiles(files, threads), [files, threads])
  const by_path = useMemo(() => new Map(files.map((file) => [file.path, file])), [files])

  const totals = useMemo(() => {
    let added = 0
    let removed = 0
    for (const summary of summaries.values()) {
      added += summary.added
      removed += summary.removed
    }
    return { added, removed }
  }, [summaries])

  return (
    <nav className={styles.tree} aria-label="Changed files">
      <div className={styles.tree_header}>
        <span>
          {files.length} file{files.length === 1 ? '' : 's'}
        </span>
        <span className={styles.spacer} />
        <span className={styles.tree_added}>+{totals.added}</span>
        <span className={styles.tree_removed}>-{totals.removed}</span>
      </div>
      <TreeRows
        nodes={tree}
        files={by_path}
        summaries={summaries}
        active_path={active_path}
        onSelect={onSelect}
      />
    </nav>
  )
}
