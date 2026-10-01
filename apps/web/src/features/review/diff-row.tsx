import type { DiffLine, DiffSide, Thread } from '@yart/core'
import { useAppDispatch } from '@/store/hooks'
import { CommentForm } from './comment-form'
import { CommentThread } from './comment-thread'
import { DraftComment } from './draft-comment'
import { newThreadDraft, type Drafting, type FileBlobs } from './drafts'
import { draftAdded } from './local-review-slice'
import type { SyntaxToken } from './syntax'
import { anchorKey } from './thread-anchors'
import styles from './review.module.css'

/** Where the comment form is open: at most one row on the page at a time. */
export interface ComposeTarget {
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
  /** The line's colours, or null to show it plain. */
  tokens: readonly SyntaxToken[] | null
  /** The file's blobs, which a drafted comment records its line against. */
  file_blobs: FileBlobs
  threads_by_anchor: ReadonlyMap<string, Thread[]>
  drafting: Drafting
  composing: ComposeTarget | null
  adding: boolean
  onComposingChange: (composing: ComposeTarget | null) => void
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
  tokens,
  file_blobs,
  threads_by_anchor,
  drafting,
  composing,
  adding,
  onComposingChange,
  onAddThread,
}: DiffRowProps) => {
  const dispatch = useAppDispatch()
  const target = targetFor(line)
  const key = target === null ? null : anchorKey(file_path, target.side, target.line)
  const at_line = key === null ? [] : (threads_by_anchor.get(key) ?? [])
  const held = key === null ? [] : (drafting.by_anchor.get(key) ?? [])
  const is_composing =
    composing !== null &&
    target !== null &&
    composing.path === file_path &&
    composing.side === target.side &&
    composing.line === target.line

  const toggleComment = () =>
    onComposingChange(
      is_composing || target === null
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
        <span className={styles.code}>
          {tokens === null
            ? line.text
            : tokens.map((token, index) => (
                <span
                  key={index}
                  style={{
                    color: token.color ?? undefined,
                    // eslint-disable-next-line @typescript-eslint/naming-convention -- React's style name
                    fontStyle: token.italic ? 'italic' : undefined,
                    // eslint-disable-next-line @typescript-eslint/naming-convention -- React's style name
                    fontWeight: token.bold ? 'bold' : undefined,
                  }}
                >
                  {token.content}
                </span>
              ))}
        </span>
      </div>

      {(at_line.length > 0 || held.length > 0 || is_composing) && (
        <div className={styles.threads}>
          {at_line.map((thread) => (
            <CommentThread
              key={thread.id}
              review_id={review_id}
              thread={thread}
              drafting={drafting}
            />
          ))}
          {held.map((draft) => (
            <DraftComment key={draft.id} review_id={review_id} draft={draft} />
          ))}
          {is_composing && target !== null && (
            <CommentForm
              pending={adding}
              submit_label="Comment now"
              queue_label={drafting.in_progress ? 'Add to review' : 'Start a review'}
              onCancel={() => onComposingChange(null)}
              onQueue={(body) => {
                const blob_sha =
                  target.side === 'head' ? file_blobs.head_blob_sha : file_blobs.base_blob_sha
                // A row only offers a side that exists, so this is a guard
                // against the impossible rather than a case to handle.
                if (blob_sha === null) return
                dispatch(
                  draftAdded({
                    review_id,
                    draft: newThreadDraft(
                      { path: file_path, side: target.side, line: target.line, blob_sha },
                      body,
                    ),
                  }),
                )
                onComposingChange(null)
              }}
              onSubmit={(body) => {
                onAddThread(target, body)
                onComposingChange(null)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
