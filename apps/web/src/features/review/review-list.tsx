import { useEffect, useMemo, useRef, useState } from 'react'
import type { Review } from '@yart/core'
import { Button } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Menu, MenuItem } from '@/components/menu'
import {
  describeRange,
  describeStatus,
  relativeTime,
  repositoryName,
  type StatusTone,
} from './format'
import {
  useDeleteReviewMutation,
  useListReviewsQuery,
  useSetReviewArchivedMutation,
} from './review-api'
import {
  keepListed,
  selectionState,
  toggleAll,
  toggleSelected,
  type Selection,
} from './review-selection'
import { countOpen } from './thread-anchors'
import styles from './review.module.css'

const STATUS_CLASS: Record<StatusTone, string> = {
  plain: '',
  approved: styles.badge_approved as string,
  changes: styles.badge_changes as string,
  working: styles.badge_working as string,
  ready: styles.badge_ready as string,
}

/**
 * The line under the title: where it is, what it covers, and when it appeared.
 *
 * The repository leads only when the list spans more than one, since in a list
 * of one project's reviews it would repeat the same word on every row.
 */
const describe = (review: Review, show_repository: boolean): string =>
  [
    show_repository ? repositoryName(review.repo_path) : null,
    review.head_branch,
    describeRange(review),
    `${review.files.length} file${review.files.length === 1 ? '' : 's'}`,
    relativeTime(review.created_at),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

interface ReviewRowProps {
  review: Review
  show_repository: boolean
  unseen: boolean
  archived: boolean
  selected: boolean
  onToggleSelected: () => void
  onArchive: () => void
  onDelete: () => void
}

const ReviewRow = ({
  review,
  show_repository,
  unseen,
  archived,
  selected,
  onToggleSelected,
  onArchive,
  onDelete,
}: ReviewRowProps) => {
  const status = describeStatus(review)
  const open = countOpen(review.threads)

  return (
    <div className={[styles.list_item, selected ? styles.list_item_selected : ''].join(' ')}>
      <input
        type="checkbox"
        className={styles.list_select}
        checked={selected}
        onChange={onToggleSelected}
        aria-label={`Select ${review.title}`}
      />
      <a className={styles.list_link} href={`/reviews/${review.id}`}>
        <div className={styles.list_title}>
          {unseen && (
            <span className={styles.unseen_dot} aria-label="Moved since you last looked" />
          )}
          {review.title}
        </div>
        <div className={styles.list_meta}>{describe(review, show_repository)}</div>
      </a>

      {/* A snapshot needs no badge of its own: the range in the meta line
          already reads "working tree". */}
      <span
        className={[styles.badge, STATUS_CLASS[status.tone]].filter(Boolean).join(' ')}
        title={status.detail ?? undefined}
      >
        {status.label}
      </span>

      <span className={styles.list_counts}>
        {open} open / {review.threads.length}
      </span>

      <Menu label={`Actions for ${review.title}`}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                onArchive()
                close()
              }}
            >
              {archived ? 'Restore' : 'Archive'}
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                onDelete()
                close()
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  )
}

export interface ReviewListProps {
  unseen: ReadonlySet<string>
}

export const ReviewList = ({ unseen }: ReviewListProps) => {
  const [archived, setArchivedView] = useState(false)
  const [selection, setSelection] = useState<Selection>(new Set())
  /** The reviews the delete dialog is asking about, or null when it is closed. */
  const [deleting, setDeleting] = useState<readonly Review[] | null>(null)
  const { data, isLoading: is_loading } = useListReviewsQuery(archived)
  const [setArchived] = useSetReviewArchivedMutation()
  const [deleteReview] = useDeleteReviewMutation()
  const select_all = useRef<HTMLInputElement>(null)

  const reviews = useMemo(() => data ?? [], [data])
  const ids = useMemo(() => reviews.map((review) => review.id), [reviews])
  const show_repository = new Set(reviews.map((review) => review.repo_path)).size > 1
  const state = selectionState(selection, ids)
  const selected = reviews.filter((review) => selection.has(review.id))

  useEffect(() => setSelection((previous) => keepListed(previous, ids)), [ids])

  // A checkbox can only be part-ticked from script.
  useEffect(() => {
    if (select_all.current !== null) select_all.current.indeterminate = state === 'some'
  }, [state])

  const archiveAll = (targets: readonly Review[]) => {
    void Promise.all(
      targets.map((review) => setArchived({ review_id: review.id, archived: !archived })),
    )
    setSelection(new Set())
  }

  const deleteAll = (targets: readonly Review[]) => {
    void Promise.all(targets.map((review) => deleteReview(review.id)))
    setSelection(new Set())
    setDeleting(null)
  }

  const threads_lost = (deleting ?? []).reduce((total, review) => total + review.threads.length, 0)

  return (
    <>
      <div className={styles.list_tabs} role="group" aria-label="Which reviews to show">
        {([false, true] as const).map((is_archived) => (
          <button
            key={String(is_archived)}
            type="button"
            aria-pressed={archived === is_archived}
            className={[styles.tab, archived === is_archived ? styles.tab_selected : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              setArchivedView(is_archived)
              setSelection(new Set())
            }}
          >
            {is_archived ? 'Archived' : 'Active'}
          </button>
        ))}
      </div>

      {is_loading && <p className={styles.notice}>Loading reviews…</p>}

      {!is_loading && reviews.length === 0 && (
        <p className={styles.notice}>
          {archived ? (
            'Nothing archived.'
          ) : (
            <>
              No reviews yet. An agent opens one with the <code>start_review</code> tool, or you can
              post to <code>/api/reviews</code>.
            </>
          )}
        </p>
      )}

      {reviews.length > 0 && (
        <>
          <div className={styles.list_toolbar}>
            <label className={styles.list_select_all}>
              <input
                ref={select_all}
                type="checkbox"
                className={styles.list_select}
                checked={state === 'all'}
                onChange={() => setSelection((previous) => toggleAll(previous, ids))}
              />
              {state === 'none' ? 'Select all' : `${selected.length} selected`}
            </label>
            {state !== 'none' && (
              <>
                <Button onClick={() => archiveAll(selected)}>
                  {archived ? 'Restore' : 'Archive'}
                </Button>
                <Button onClick={() => setDeleting(selected)}>Delete</Button>
                <Button tone="quiet" onClick={() => setSelection(new Set())}>
                  Clear
                </Button>
              </>
            )}
          </div>

          <div className={styles.list}>
            {reviews.map((review) => (
              <ReviewRow
                key={review.id}
                review={review}
                show_repository={show_repository}
                unseen={unseen.has(review.id)}
                archived={archived}
                selected={selection.has(review.id)}
                onToggleSelected={() =>
                  setSelection((previous) => toggleSelected(previous, review.id))
                }
                onArchive={() => archiveAll([review])}
                onDelete={() => setDeleting([review])}
              />
            ))}
          </div>
        </>
      )}

      {/* Deleting discards every comment on a review and cannot be undone, so
          the dialog names what goes rather than only asking whether. */}
      {deleting !== null && (
        <ConfirmDialog
          open
          title={`Delete ${plural(deleting.length, 'review')}?`}
          confirm_label={`Delete ${plural(deleting.length, 'review')}`}
          onConfirm={() => deleteAll(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <p>
            {threads_lost === 0
              ? 'This cannot be undone.'
              : `${plural(threads_lost, 'comment thread')} ${threads_lost === 1 ? 'goes' : 'go'} with ${
                  deleting.length === 1 ? 'it' : 'them'
                }. This cannot be undone.`}
          </p>
          <ul className={styles.delete_list}>
            {deleting.map((review) => (
              <li key={review.id}>
                {review.title}
                <span className={styles.delete_list_count}>
                  {plural(review.threads.length, 'thread')}
                </span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </>
  )
}
