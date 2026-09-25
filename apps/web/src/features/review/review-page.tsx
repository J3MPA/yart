import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { agentActivity, currentSubmission } from '@yart/core'
import type { ReviewVerdict } from '@yart/core'
import { Button } from '@/components/button'
import { useAppDispatch } from '@/store/hooks'
import { CommentForm } from './comment-form'
import { DiffFile } from './diff-file'
import type { PendingComment } from './diff-row'
import { scrollToFile } from './file-anchors'
import { FileSidebar } from './file-sidebar'
import { orderFilesByTree } from './file-tree'
import { reviewSeen } from './seen-slice'
import { useActiveFile } from './use-active-file'
import { describeRange, relativeTime, VERDICT_LABEL } from './format'
import {
  useAddSubmissionCommentMutation,
  useGetReviewDiffQuery,
  useGetReviewQuery,
  useSubmitReviewMutation,
} from './review-api'
import { describeQueryError } from './query-error'
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

/** A dead end still needs a way out, so failures keep the way back. */
const Missing = ({ children }: { children: ReactNode }) => (
  <>
    <a className={styles.back} href="/">
      ← All reviews
    </a>
    <p className={styles.notice}>{children}</p>
  </>
)

export const ReviewPage = ({ review_id }: ReviewPageProps) => {
  const review_query = useGetReviewQuery(review_id)
  const diff_query = useGetReviewDiffQuery(review_id)
  const [submitReview, submit_state] = useSubmitReviewMutation()
  const [pending, setPending] = useState<PendingComment | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [answering, setAnswering] = useState(false)
  const [addSubmissionComment, answer_state] = useAddSubmissionCommentMutation()
  const [summary, setSummary] = useState('')

  const dispatch = useAppDispatch()
  const review = review_query.data

  // Looking at the review is what marks it seen, and it stays seen while it is
  // open: anything that arrives now arrives in front of someone reading it.
  useEffect(() => {
    if (review === undefined) return
    dispatch(reviewSeen({ review_id: review.id, activity: agentActivity(review) }))
  }, [review, dispatch])

  const threads_by_anchor = useMemo(
    () => groupThreadsByAnchor(review?.threads ?? []),
    [review?.threads],
  )
  // Ordered here rather than in the sidebar, so that the tree and the diffs
  // below it are one list read the same way round.
  const files = useMemo(() => orderFilesByTree(diff_query.data ?? []), [diff_query.data])
  const paths = useMemo(() => files.map((file) => file.path), [files])
  const active_path = useActiveFile(paths)

  if (review_query.isLoading || diff_query.isLoading) {
    return <p className={styles.notice}>Loading review…</p>
  }

  if (review_query.isError) {
    const described = describeQueryError(review_query.error)
    return (
      <Missing>
        {described.is_missing ? `No review with id ${review_id}.` : described.message}
      </Missing>
    )
  }

  if (review === undefined) {
    return <Missing>No review with id {review_id}.</Missing>
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
    <>
      {/* A real link rather than history.back(): a review is usually reached by
          a deep link from an agent, where there is nothing to go back to. */}
      <a className={styles.back} href="/">
        ← All reviews
      </a>

      <header className={styles.header}>
        <h1 className={styles.title}>{review.title}</h1>
        <span className={styles.range}>
          {review.head_branch === null ? '' : `${review.head_branch} · `}
          {describeRange(review)} · round {review.rounds.length} · {relativeTime(review.created_at)}
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

          {submission.comments.map((comment) => (
            <div key={comment.id} className={styles.verdict_reply}>
              <div className={styles.comment_author}>{comment.author}</div>
              <div className={styles.comment_body}>{comment.body}</div>
            </div>
          ))}

          {answering ? (
            <div className={styles.verdict_form}>
              <CommentForm
                placeholder="Reply to this verdict"
                submit_label="Reply"
                pending={answer_state.isLoading}
                onCancel={() => setAnswering(false)}
                onSubmit={(body) => {
                  void addSubmissionComment({
                    review_id,
                    submission_id: submission.id,
                    body,
                  })
                  setAnswering(false)
                }}
              />
            </div>
          ) : (
            <div className={styles.verdict_actions}>
              <Button tone="quiet" onClick={() => setAnswering(true)}>
                Reply
              </Button>
            </div>
          )}
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
        files.length === 0 && <p className={styles.notice}>Nothing changed in this range.</p>
      )}

      {files.length > 0 && (
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <FileSidebar
              files={files}
              threads={review.threads}
              active_path={active_path}
              onSelect={scrollToFile}
            />
          </aside>

          <div className={styles.diffs}>
            {files.map((file) => (
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
        </div>
      )}
    </>
  )
}
