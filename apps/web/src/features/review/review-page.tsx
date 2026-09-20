import { useMemo, useState } from 'react'
import type { ReviewVerdict } from '@yart/core'
import { Button } from '@/components/button'
import { DiffFile, type PendingComment } from './diff-file'
import { relativeTime, shortSha, VERDICT_LABEL } from './format'
import { useGetReviewDiffQuery, useGetReviewQuery, useSubmitReviewMutation } from './review-api'
import { describeQueryError } from './query-error'
import { currentSubmission } from './submission'
import { countOpen, groupThreadsByAnchor } from './thread-anchors'
import styles from './review.module.css'

const VERDICT_CLASS: Record<ReviewVerdict, string> = {
  approved: styles.verdict_approved as string,
  changes_requested: styles.verdict_changes as string,
  commented: styles.verdict_commented as string,
}

export interface ReviewPageProps {
  review_id: string
}

export const ReviewPage = ({ review_id }: ReviewPageProps) => {
  const review_query = useGetReviewQuery(review_id)
  const diff_query = useGetReviewDiffQuery(review_id)
  const [submitReview, submit_state] = useSubmitReviewMutation()
  const [pending, setPending] = useState<PendingComment | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [summary, setSummary] = useState('')

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
  const submission = currentSubmission(review)
  const submitted = submission !== null

  const submit = (verdict: ReviewVerdict) => {
    void submitReview({ review_id, verdict, body: summary })
    setSummary('')
    setSubmitting(false)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{review.title}</h1>
        <span className={styles.range}>
          {review.head_branch === null ? '' : `${review.head_branch} · `}
          {shortSha(review.base_sha)}..{shortSha(review.head_sha)} · round {review.rounds.length} ·{' '}
          {relativeTime(review.created_at)}
        </span>
        <span className={styles.spacer} />
        <span className={styles.badge}>
          {open_count} open / {review.threads.length}
        </span>
        <Button
          tone="primary"
          disabled={submit_state.isLoading}
          onClick={() => setSubmitting(!submitting)}
        >
          {submitting ? 'Cancel' : submitted ? 'Submit again' : 'Submit review'}
        </Button>
      </header>

      {submission !== null && (
        <div
          className={[styles.verdict_banner, VERDICT_CLASS[submission.verdict]]
            .filter(Boolean)
            .join(' ')}
        >
          <div className={styles.verdict_label}>
            {VERDICT_LABEL[submission.verdict]} · {relativeTime(submission.created_at)}
          </div>
          {submission.body !== null && <div className={styles.verdict_body}>{submission.body}</div>}
        </div>
      )}

      {submitting && (
        <div className={styles.submit_panel}>
          <div className={styles.submit_heading}>Finish your review</div>
          <textarea
            className={styles.textarea}
            value={summary}
            placeholder="Summary (optional)"
            aria-label="Review summary"
            autoFocus
            onChange={(event) => setSummary(event.target.value)}
          />
          <div className={styles.submit_actions}>
            <Button onClick={() => submit('commented')}>Comment</Button>
            <Button tone="primary" onClick={() => submit('approved')}>
              Approve
            </Button>
            <Button onClick={() => submit('changes_requested')}>Request changes</Button>
          </div>
        </div>
      )}

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
