import { useState } from 'react'
import type { Review } from '@yart/core'
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

interface ReviewRowProps {
  review: Review
  show_repository: boolean
  unseen: boolean
  archived: boolean
  confirming_delete: boolean
  onConfirmDelete: (review_id: string | null) => void
}

const ReviewRow = ({
  review,
  show_repository,
  unseen,
  archived,
  confirming_delete,
  onConfirmDelete,
}: ReviewRowProps) => {
  const [setArchived] = useSetReviewArchivedMutation()
  const [deleteReview] = useDeleteReviewMutation()

  const status = describeStatus(review)
  const open = countOpen(review.threads)

  return (
    <div className={styles.list_item}>
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

      <Menu label={`Actions for ${review.title}`} onClose={() => onConfirmDelete(null)}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                void setArchived({ review_id: review.id, archived: !archived })
                close()
              }}
            >
              {archived ? 'Restore' : 'Archive'}
            </MenuItem>

            {/* Two steps rather than a browser dialog: deleting a review
                discards every comment on it, and there is no undo. */}
            {confirming_delete ? (
              <>
                <MenuItem
                  danger
                  onClick={() => {
                    void deleteReview(review.id)
                    onConfirmDelete(null)
                    close()
                  }}
                >
                  Confirm delete
                </MenuItem>
                <MenuItem onClick={() => onConfirmDelete(null)}>Keep it</MenuItem>
              </>
            ) : (
              <MenuItem danger onClick={() => onConfirmDelete(review.id)}>
                Delete
              </MenuItem>
            )}
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
  const [confirming, setConfirming] = useState<string | null>(null)
  const { data, isLoading: is_loading } = useListReviewsQuery(archived)

  const reviews = data ?? []
  const show_repository = new Set(reviews.map((review) => review.repo_path)).size > 1

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
              setConfirming(null)
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
        <div className={styles.list}>
          {reviews.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              show_repository={show_repository}
              unseen={unseen.has(review.id)}
              archived={archived}
              confirming_delete={confirming === review.id}
              onConfirmDelete={setConfirming}
            />
          ))}
        </div>
      )}
    </>
  )
}
