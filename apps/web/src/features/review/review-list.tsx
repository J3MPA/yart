import { useState } from 'react'
import type { Review } from '@yart/core'
import { Button } from '@/components/button'
import { describeRange, relativeTime, VERDICT_LABEL } from './format'
import {
  useDeleteReviewMutation,
  useListReviewsQuery,
  useSetReviewArchivedMutation,
} from './review-api'
import { currentSubmission } from './submission'
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

      <span className={styles.list_counts}>
        {open} open / {review.threads.length}
      </span>

      <div className={styles.list_actions}>
        <Button
          tone="quiet"
          onClick={() => void setArchived({ review_id: review.id, archived: !archived })}
        >
          {archived ? 'Restore' : 'Archive'}
        </Button>

        {/* Two clicks rather than a browser dialog: deleting a review discards
            every comment on it, and there is no undo. */}
        {confirming_delete ? (
          <>
            <Button
              tone="quiet"
              className={styles.danger}
              onClick={() => {
                void deleteReview(review.id)
                onConfirmDelete(null)
              }}
            >
              Really delete
            </Button>
            <Button tone="quiet" onClick={() => onConfirmDelete(null)}>
              Keep
            </Button>
          </>
        ) : (
          <Button tone="quiet" onClick={() => onConfirmDelete(review.id)}>
            Delete
          </Button>
        )}
      </div>
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
      <div className={styles.list_tabs}>
        <Button
          tone={archived ? 'default' : 'primary'}
          onClick={() => {
            setArchivedView(false)
            setConfirming(null)
          }}
        >
          Active
        </Button>
        <Button
          tone={archived ? 'primary' : 'default'}
          onClick={() => {
            setArchivedView(true)
            setConfirming(null)
          }}
        >
          Archived
        </Button>
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
