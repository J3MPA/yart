import type { DiffLine, DiffSide, FileDiff, Thread } from '@yart/core'
import { CommentForm } from './comment-form'
import { CommentThread } from './comment-thread'
import { useAddThreadMutation } from './review-api'
import { anchorKey, outdatedThreadsForPath } from './thread-anchors'
import styles from './review.module.css'

export interface PendingComment {
  path: string
  side: DiffSide
  line: number
}

export interface DiffFileProps {
  review_id: string
  file: FileDiff
  threads: readonly Thread[]
  threads_by_anchor: ReadonlyMap<string, Thread[]>
  pending: PendingComment | null
  onPendingChange: (pending: PendingComment | null) => void
}

const MARKER: Record<DiffLine['kind'], string> = {
  context: ' ',
  added: '+',
  removed: '-',
}

/**
 * A comment attaches to whichever side of the diff the row actually exists on.
 * A removed line only exists in the base, an added line only in the head, and a
 * context line is addressed on the head because that is the version being
 * reviewed.
 */
const sideFor = (line: DiffLine): { side: DiffSide; line: number } | null => {
  if (line.kind === 'removed') {
    return line.base_line === null ? null : { side: 'base', line: line.base_line }
  }
  return line.head_line === null ? null : { side: 'head', line: line.head_line }
}

export const DiffFile = ({
  review_id,
  file,
  threads,
  threads_by_anchor,
  pending,
  onPendingChange,
}: DiffFileProps) => {
  const [addThread, add_state] = useAddThreadMutation()
  const outdated = outdatedThreadsForPath(threads, file.path)

  return (
    <section className={styles.file}>
      <header className={styles.file_header}>
        <span className={styles.file_status}>{file.status}</span>
        <span className={styles.file_path}>{file.path}</span>
        {file.old_path !== null && <span className={styles.file_status}>was {file.old_path}</span>}
      </header>

      {outdated.length > 0 && (
        <div className={styles.outdated}>
          <div className={styles.outdated_label}>
            {outdated.length} comment{outdated.length === 1 ? '' : 's'} on lines that no longer
            exist
          </div>
          {outdated.map((thread) => (
            <div key={thread.id}>
              <div className={styles.outdated_context}>{thread.context.line}</div>
              <CommentThread review_id={review_id} thread={thread} />
            </div>
          ))}
        </div>
      )}

      {file.is_binary && <p className={styles.binary}>Binary file — not shown.</p>}

      {file.hunks.map((hunk) => (
        <div key={hunk.header}>
          <div className={styles.hunk_header}>{hunk.header}</div>
          {hunk.lines.map((line, index) => {
            const target = sideFor(line)
            const key = target === null ? null : anchorKey(file.path, target.side, target.line)
            const at_line = key === null ? [] : (threads_by_anchor.get(key) ?? [])
            const is_pending =
              pending !== null &&
              target !== null &&
              pending.path === file.path &&
              pending.side === target.side &&
              pending.line === target.line

            return (
              <div key={`${hunk.header}-${index}`}>
                <div
                  className={[
                    styles.row,
                    line.kind === 'added' ? styles.row_added : '',
                    line.kind === 'removed' ? styles.row_removed : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
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
                        aria-label={`Comment on ${file.path} line ${target.line}`}
                        onClick={() =>
                          onPendingChange(
                            is_pending
                              ? null
                              : { path: file.path, side: target.side, line: target.line },
                          )
                        }
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
                        pending={add_state.isLoading}
                        onCancel={() => onPendingChange(null)}
                        onSubmit={(body) => {
                          void addThread({
                            review_id,
                            path: file.path,
                            line: target.line,
                            side: target.side,
                            body,
                          })
                          onPendingChange(null)
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}
