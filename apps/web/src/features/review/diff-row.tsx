import type { Attachment, DiffLine, DiffSide, Thread } from '@yart/core'

import { useAppDispatch } from '@/store/hooks'
import { CommentForm } from './comment-form'
import { CommentThread } from './comment-thread'
import { DraftComment } from './draft-comment'
import { newThreadDraft, type Drafting, type FileBlobs } from './drafts'
import { draftAdded } from './local-review-slice'
import type { SyntaxToken } from './syntax'
import { anchorKey } from './thread-anchors'
import { unsentKey } from './unsent'
import styles from './review.module.css'

/** Where the comment form is open. Only one row on the page at a time. */
export interface ComposeTarget {
  path: string
  side: DiffSide
  line: number
}

/** The side and the line of a comment on this row. */
export interface RowTarget {
  side: DiffSide
  line: number
}

export interface DiffRowProps {
  review_id: string
  file_path: string
  line: DiffLine
  /** The colors of the line, or null to show it as plain text. */
  tokens: readonly SyntaxToken[] | null
  /** The blobs of the file. A draft comment records its line against them. */
  file_blobs: FileBlobs
  threads_by_anchor: ReadonlyMap<string, Thread[]>
  drafting: Drafting
  composing: ComposeTarget | null
  adding: boolean
  onComposingChange: (composing: ComposeTarget | null) => void
  /** Sends a comment on a line. It rejects when the daemon did not save it. */
  onAddThread: (target: RowTarget, body: string, attachments: Attachment[]) => Promise<void>
}

const MARKER: Record<DiffLine['kind'], string> = {
  context: ' ',
  added: '+',
  removed: '-',
}

/**
 * Tells if the click was the end of a text selection, not a usual click.
 *
 * You can click all of the row. Without this check, each selection of code would
 * open a comment form when someone tried to copy a line.
 */
const isSelecting = (): boolean => (window.getSelection()?.toString() ?? '') !== ''

/**
 * A comment goes on the side of the diff where the row exists. A removed line
 * exists only in the base. An added line exists only in the head. A context line
 * uses the head, because that is the version under review.
 */
const targetFor = (line: DiffLine): RowTarget | null => {
  if (line.kind === 'removed') {
    return line.base_line === null ? null : { side: 'base', line: line.base_line }
  }
  return line.head_line === null ? null : { side: 'head', line: line.head_line }
}

/** One line of a diff, with its conversation below it. */
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
                // The row also does this. Without a stop here, it would toggle
                // two times and cancel itself.
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
              review_id={review_id}
              pending={adding}
              unsent_key={unsentKey(review_id, `line ${key}`)}
              submit_label="Comment now"
              queue_label={drafting.in_progress ? 'Add to review' : 'Start a review'}
              onCancel={() => onComposingChange(null)}
              onQueue={(body, attachments) => {
                const blob_sha =
                  target.side === 'head' ? file_blobs.head_blob_sha : file_blobs.base_blob_sha
                // A row offers only a side that exists. Thus this guard is for a
                // case that cannot occur.
                if (blob_sha === null) return
                dispatch(
                  draftAdded({
                    review_id,
                    draft: newThreadDraft(
                      { path: file_path, side: target.side, line: target.line, blob_sha },
                      body,
                      attachments,
                    ),
                  }),
                )
                onComposingChange(null)
              }}
              onSubmit={async (body, attachments) => {
                await onAddThread(target, body, attachments)
                onComposingChange(null)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
