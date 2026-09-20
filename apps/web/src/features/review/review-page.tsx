import { useMemo, useState } from 'react'
import { Button } from '@/components/button'
import { DiffFile, type PendingComment } from './diff-file'
import { useGetReviewDiffQuery, useGetReviewQuery, useSubmitReviewMutation } from './review-api'
import { describeQueryError } from './query-error'
import { countOpen, groupThreadsByAnchor } from './thread-anchors'
import styles from './review.module.css'

export interface ReviewPageProps {
  review_id: string
}

export const ReviewPage = ({ review_id }: ReviewPageProps) => {
  const review_query = useGetReviewQuery(review_id)
  const diff_query = useGetReviewDiffQuery(review_id)
  const [submitReview, submit_state] = useSubmitReviewMutation()
  const [pending, setPending] = useState<PendingComment | null>(null)

  const review = review_query.data
  const threads_by_anchor = useMemo(
    () => groupThreadsByAnchor(review?.threads ?? []),
    [review?.threads],
  )

  if (review_query.isLoading || diff_query.isLoading) {
    return <p className={styles.notice}>Loading review…</p>
  }

  if (review_query.isError) {
    const described = describeQueryError(review_query.error)
    return (
      <p className={styles.notice}>
        {described.is_missing ? `No review with id ${review_id}.` : described.message}
      </p>
    )
  }

  if (review === undefined) {
    return <p className={styles.notice}>No review with id {review_id}.</p>
  }

  const open_count = countOpen(review.threads)
  const submitted = review.status === 'submitted'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Review</h1>
        <span className={styles.range}>
          {review.base}..{review.head}
        </span>
        <span className={styles.range}>round {review.rounds.length}</span>
        <span className={styles.spacer} />
        <span
          className={[styles.badge, submitted ? styles.badge_submitted : '']
            .filter(Boolean)
            .join(' ')}
        >
          {review.status}
        </span>
        <span className={styles.badge}>
          {open_count} open / {review.threads.length}
        </span>
        <Button
          tone="primary"
          disabled={submitted || submit_state.isLoading}
          onClick={() => void submitReview(review_id)}
        >
          {submitted ? 'Submitted' : 'Submit review'}
        </Button>
      </header>

      {diff_query.isError ? (
        <p className={styles.notice}>
          Could not load the diff: {describeQueryError(diff_query.error).message}
        </p>
      ) : (
        (diff_query.data ?? []).length === 0 && (
          <p className={styles.notice}>Nothing changed in this range.</p>
        )
      )}

      {(diff_query.data ?? []).map((file) => (
        <DiffFile
          key={file.path}
          review_id={review_id}
          file={file}
          threads={review.threads}
          threads_by_anchor={threads_by_anchor}
          pending={pending}
          onPendingChange={setPending}
        />
      ))}
    </div>
  )
}
