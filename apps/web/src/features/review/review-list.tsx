import { useListReviewsQuery } from './review-api'
import { countOpen } from './thread-anchors'
import styles from './review.module.css'

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
      {reviews.map((review) => (
        <a key={review.id} className={styles.list_item} href={`/reviews/${review.id}`}>
          <span className={styles.badge}>{review.status}</span>
          <span className={styles.range}>
            {review.base}..{review.head}
          </span>
          <span className={styles.spacer} />
          <span className={styles.file_status}>
            {countOpen(review.threads)} open / {review.threads.length}
          </span>
        </a>
      ))}
    </div>
  )
}
