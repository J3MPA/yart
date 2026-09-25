import { useMemo } from 'react'
import type { FileDiff, Thread } from '@yart/core'
import { Chevron } from '@/components/chevron'
import { CommentIcon } from '@/components/comment-icon'
import { buildFileTree, flattenFileTree, type TreeNode } from './file-tree'
import { sumSummaries, summarizeFiles, type FileSummary } from './file-summary'
import styles from './review.module.css'

export interface FileSidebarProps {
  files: readonly FileDiff[]
  threads: readonly Thread[]
  /** The file the page is currently showing, marked in the list. */
  active_path: string | null
  /** Directory paths folded away. */
  folded: ReadonlySet<string>
  /** Files marked reviewed at their current content. */
  reviewed: ReadonlySet<string>
  onSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
}

const STATUS_LETTER: Record<FileDiff['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
}

/** What the rows below the header read, gathered so it is passed down once. */
interface TreeView {
  files: ReadonlyMap<string, FileDiff>
  summaries: ReadonlyMap<string, FileSummary>
  active_path: string | null
  folded: ReadonlySet<string>
  reviewed: ReadonlySet<string>
}

interface TreeRowsProps {
  nodes: readonly TreeNode[]
  view: TreeView
  onSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
}

const Counts = ({ summary }: { summary: FileSummary }) => (
  <>
    {summary.open_threads > 0 && (
      <span
        className={styles.tree_threads}
        title={
          summary.open_threads === summary.total_threads
            ? `${summary.open_threads} open comment${summary.open_threads === 1 ? '' : 's'}`
            : `${summary.open_threads} of ${summary.total_threads} comments open`
        }
        aria-label={`${summary.open_threads} open comment${summary.open_threads === 1 ? '' : 's'}`}
        role="img"
      >
        <CommentIcon />
      </span>
    )}
    <span className={styles.tree_counts}>
      <span className={styles.tree_added}>+{summary.added}</span>{' '}
      <span className={styles.tree_removed}>-{summary.removed}</span>
    </span>
  </>
)

const classes = (...names: (string | false | undefined)[]): string =>
  names.filter(Boolean).join(' ')

const TreeRows = ({ nodes, view, onSelect, onToggleDirectory }: TreeRowsProps) => (
  <ul className={styles.tree_list}>
    {nodes.map((node) => {
      if (node.kind === 'directory') {
        const is_folded = view.folded.has(node.path)
        const hidden = is_folded ? flattenFileTree(node.children) : []
        // A folded directory stands in for the file being read, or the mark
        // would vanish from the tree whenever that file's directory was folded.
        const holds_active =
          is_folded && view.active_path !== null && hidden.includes(view.active_path)

        return (
          <li key={node.path}>
            <button
              type="button"
              className={classes(styles.tree_directory, holds_active && styles.tree_file_active)}
              aria-expanded={!is_folded}
              title={node.path}
              onClick={() => onToggleDirectory(node.path)}
            >
              <span className={styles.tree_chevron}>
                <Chevron expanded={!is_folded} />
              </span>
              <span className={styles.tree_name}>{node.name}</span>
              {is_folded && (
                <Counts
                  summary={sumSummaries(
                    hidden
                      .map((path) => view.summaries.get(path))
                      .filter((summary): summary is FileSummary => summary !== undefined),
                  )}
                />
              )}
            </button>
            {!is_folded && (
              <TreeRows
                nodes={node.children}
                view={view}
                onSelect={onSelect}
                onToggleDirectory={onToggleDirectory}
              />
            )}
          </li>
        )
      }

      const file = view.files.get(node.path)
      const summary = view.summaries.get(node.path)
      const is_active = node.path === view.active_path
      const is_reviewed = view.reviewed.has(node.path)

      return (
        <li key={node.path}>
          {/* A button rather than a fragment link: a path can hold characters
              a URL fragment would have to escape, and there is no router here
              to give the escaping a second home. */}
          <button
            type="button"
            className={classes(
              styles.tree_file,
              is_active && styles.tree_file_active,
              is_reviewed && styles.tree_file_reviewed,
            )}
            title={is_reviewed ? `${node.path} (reviewed)` : node.path}
            aria-current={is_active ? 'true' : undefined}
            onClick={() => onSelect(node.path)}
          >
            <span className={styles.tree_status}>
              {is_reviewed ? '✓' : file === undefined ? '' : STATUS_LETTER[file.status]}
            </span>
            <span className={styles.tree_name}>{node.name}</span>
            {summary !== undefined && <Counts summary={summary} />}
          </button>
        </li>
      )
    })}
  </ul>
)

/** The changed files of a review, as a tree, with what is waiting in each. */
export const FileSidebar = ({
  files,
  threads,
  active_path,
  folded,
  reviewed,
  onSelect,
  onToggleDirectory,
}: FileSidebarProps) => {
  const tree = useMemo(() => buildFileTree(files.map((file) => file.path)), [files])
  const summaries = useMemo(() => summarizeFiles(files, threads), [files, threads])
  const by_path = useMemo(() => new Map(files.map((file) => [file.path, file])), [files])
  const totals = useMemo(() => sumSummaries(summaries.values()), [summaries])

  const view: TreeView = { files: by_path, summaries, active_path, folded, reviewed }

  return (
    <nav className={styles.tree} aria-label="Changed files">
      <div className={styles.tree_header}>
        <span>
          {reviewed.size > 0
            ? `${reviewed.size} of ${files.length} reviewed`
            : `${files.length} file${files.length === 1 ? '' : 's'}`}
        </span>
        <span className={styles.spacer} />
        <span className={styles.tree_added}>+{totals.added}</span>
        <span className={styles.tree_removed}>-{totals.removed}</span>
      </div>
      <TreeRows
        nodes={tree}
        view={view}
        onSelect={onSelect}
        onToggleDirectory={onToggleDirectory}
      />
    </nav>
  )
}
