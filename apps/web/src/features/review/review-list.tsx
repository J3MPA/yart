import type { Review } from '@yart/core'
import { relativeTime, shortSha, VERDICT_LABEL } from './format'
import { useListReviewsQuery } from './review-api'
import { currentSubmission } from './submission'
import { countOpen } from './thread-anchors'
import styles from './review.module.css'

/** The line under the title: where it is, what it covers, and when it appeared. */
const describe = (review: Review): string =>
  [
    review.head_branch,
    `${shortSha(review.base_sha)}..${shortSha(review.head_sha)}`,
    `${review.files.length} file${review.files.length === 1 ? '' : 's'}`,
    relativeTime(review.created_at),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

export const ReviewList = () => {
  const { data, isLoading: is_loading } = useListReviewsQuery()

  if (is_loading) return <p className={styles.notice}>Loading reviews…</p>

  const reviews = data ?? []
  if (reviews.length === 0) {
    return (
      <p className={styles.notice}>
        No reviews yet. An agent opens one with the <code>start_review</code> tool, or you can post
        to <code>/api/reviews</code>.
      </p>
    )
  }

  return (
    <div className={styles.list}>
      {reviews.map((review) => {
        const submission = currentSubmission(review)
        const open = countOpen(review.threads)

        return (
          <a key={review.id} className={styles.list_item} href={`/reviews/${review.id}`}>
            <div className={styles.list_main}>
              <div className={styles.list_title}>{review.title}</div>
              <div className={styles.list_meta}>{describe(review)}</div>
            </div>
            <span className={styles.spacer} />
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
          </a>
        )
      })}
    </div>
  )
}
