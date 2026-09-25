import { useState } from 'react'
import { currentSubmission, reviewProgress } from '@yart/core'
import type { Review } from '@yart/core'
import { Menu, MenuItem } from '@/components/menu'
import { describeProgress, describeRange, relativeTime, VERDICT_LABEL } from './format'
import {
  useDeleteReviewMutation,
  useListReviewsQuery,
  useSetReviewArchivedMutation,
} from './review-api'
import { countOpen } from './thread-anchors'
import styles from './review.module.css'

/** The line under the title: where it is, what it covers, and when it appeared. */
const describe = (review: Review): string =>
  [
    review.head_branch,
    describeRange(review),
    `${review.files.length} file${review.files.length === 1 ? '' : 's'}`,
    relativeTime(review.created_at),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

interface ReviewRowProps {
  review: Review
  archived: boolean
  confirming_delete: boolean
  onConfirmDelete: (review_id: string | null) => void
}

const ReviewRow = ({ review, archived, confirming_delete, onConfirmDelete }: ReviewRowProps) => {
  const [setArchived] = useSetReviewArchivedMutation()
  const [deleteReview] = useDeleteReviewMutation()

  const submission = currentSubmission(review)
  const progress = describeProgress(reviewProgress(review))
  const open = countOpen(review.threads)

  return (
    <div className={styles.list_item}>
      <a className={styles.list_link} href={`/reviews/${review.id}`}>
        <div className={styles.list_title}>{review.title}</div>
        <div className={styles.list_meta}>{describe(review)}</div>
      </a>

      {review.head_is_snapshot && <span className={styles.badge}>uncommitted</span>}

      {submission === null ? (
        <span className={styles.badge}>open</span>
      ) : (
        <span
          className={[
            styles.badge,
            submission.verdict === 'approved' ? styles.badge_approved : '',
            submission.verdict === 'changes_requested' ? styles.badge_changes : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {VERDICT_LABEL[submission.verdict]}
        </span>
      )}

      {progress !== null && (
        <span
          className={[
            styles.badge,
            progress === 'ready for re-review' ? styles.badge_ready : styles.badge_working,
          ].join(' ')}
        >
          {progress}
        </span>
      )}

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

export const ReviewList = () => {
  const [archived, setArchivedView] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const { data, isLoading: is_loading } = useListReviewsQuery(archived)

  const reviews = data ?? []

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
