import type { DiffLine, DiffSide, Thread } from '@yart/core'
import { CommentForm } from './comment-form'
import { CommentThread } from './comment-thread'
import { anchorKey } from './thread-anchors'
import styles from './review.module.css'

export interface PendingComment {
  path: string
  side: DiffSide
  line: number
}

/** The side and line a comment on this row would attach to. */
export interface RowTarget {
  side: DiffSide
  line: number
}

export interface DiffRowProps {
  review_id: string
  file_path: string
  line: DiffLine
  threads_by_anchor: ReadonlyMap<string, Thread[]>
  pending: PendingComment | null
  adding: boolean
  onPendingChange: (pending: PendingComment | null) => void
  onAddThread: (target: RowTarget, body: string) => void
}

const MARKER: Record<DiffLine['kind'], string> = {
  context: ' ',
  added: '+',
  removed: '-',
}

/**
 * Whether the click was the end of a text selection rather than a plain click.
 *
 * The whole row is clickable, so selecting code would otherwise open a comment
 * form every time someone tried to copy a line.
 */
const isSelecting = (): boolean => (window.getSelection()?.toString() ?? '') !== ''

/**
 * A comment attaches to whichever side of the diff the row actually exists on.
 * A removed line only exists in the base, an added line only in the head, and a
 * context line is addressed on the head because that is the version being
 * reviewed.
 */
const targetFor = (line: DiffLine): RowTarget | null => {
  if (line.kind === 'removed') {
    return line.base_line === null ? null : { side: 'base', line: line.base_line }
  }
  return line.head_line === null ? null : { side: 'head', line: line.head_line }
}

/** One line of a diff, with whatever conversation hangs beneath it. */
export const DiffRow = ({
  review_id,
  file_path,
  line,
  threads_by_anchor,
  pending,
  adding,
  onPendingChange,
  onAddThread,
}: DiffRowProps) => {
  const target = targetFor(line)
  const key = target === null ? null : anchorKey(file_path, target.side, target.line)
  const at_line = key === null ? [] : (threads_by_anchor.get(key) ?? [])
  const is_pending =
    pending !== null &&
    target !== null &&
    pending.path === file_path &&
    pending.side === target.side &&
    pending.line === target.line

  const toggleComment = () =>
    onPendingChange(
      is_pending || target === null
        ? null
        : { path: file_path, side: target.side, line: target.line },
    )

  return (
    <div>
      {/* The row is clickable for the mouse; the button inside it is
          what keyboard and assistive technology use. */}
      <div
        className={[
          styles.row,
          target === null ? '' : styles.row_clickable,
          line.kind === 'added' ? styles.row_added : '',
          line.kind === 'removed' ? styles.row_removed : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={
          target === null
            ? undefined
            : () => {
                if (isSelecting()) return
                toggleComment()
              }
        }
      >
        <span className={styles.gutter}>{line.base_line ?? ''}</span>
        <span className={styles.gutter}>{line.head_line ?? ''}</span>
        <span
          className={[
            styles.marker,
            line.kind === 'added' ? styles.marker_added : '',
            line.kind === 'removed' ? styles.marker_removed : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {MARKER[line.kind]}
          {target !== null && (
            <button
              type="button"
              className={styles.add_button}
              aria-label={`Comment on ${file_path} line ${target.line}`}
              onClick={(event) => {
                // The row handles this too; without stopping here it
                // would toggle twice and cancel itself out.
                event.stopPropagation()
                toggleComment()
              }}
            >
              +
            </button>
          )}
        </span>
        <span className={styles.code}>{line.text}</span>
      </div>

      {(at_line.length > 0 || is_pending) && (
        <div className={styles.threads}>
          {at_line.map((thread) => (
            <CommentThread key={thread.id} review_id={review_id} thread={thread} />
          ))}
          {is_pending && target !== null && (
            <CommentForm
              pending={adding}
              onCancel={() => onPendingChange(null)}
              onSubmit={(body) => {
                onAddThread(target, body)
                onPendingChange(null)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
