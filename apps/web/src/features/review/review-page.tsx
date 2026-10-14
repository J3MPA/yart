import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { agentActivity, currentSubmission, describeAuthor, submissionAuthor } from '@yart/core'
import type { ReviewVerdict } from '@yart/core'
import { Button } from '@/components/button'
import { AuthorLabel } from './author-label'
import { hasAiReview } from './review-history'
import { ReviewHistoryPanel } from './review-history-panel'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { CommentForm } from './comment-form'
import { DiffFile } from './diff-file'
import type { ComposeTarget } from './diff-row'
import { groupDrafts, type Drafting } from './drafts'
import { scrollToFile } from './file-anchors'
import { FileSidebar } from './file-sidebar'
import { orderFilesByTree } from './file-tree'
import { directoryToggled, fileReviewedSet } from './local-review-slice'
import { isReviewed, localFor, reviewBlob } from './local-review-state'
import { reviewSeen } from './seen-slice'
import { SubmitPanel } from './submit-panel'
import { useActiveFile } from './use-active-file'
import { describeRange, relativeTime, repositoryName, VERDICT_LABEL } from './format'
import {
  useAddSubmissionCommentMutation,
  useGetReviewDiffQuery,
  useGetReviewQuery,
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

/** A page with no result still needs a way out. Thus a failure keeps the link back. */
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
  const [composing, setComposing] = useState<ComposeTarget | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [answering, setAnswering] = useState(false)
  const [addSubmissionComment, answer_state] = useAddSubmissionCommentMutation()
  const [summary, setSummary] = useState('')

  const dispatch = useAppDispatch()
  const review = review_query.data

  // When you look at the review, it becomes seen. It stays seen while it is
  // open, because all that comes now comes in front of a person who reads it.
  useEffect(() => {
    if (review === undefined) return
    dispatch(reviewSeen({ review_id: review.id, activity: agentActivity(review) }))
  }, [review, dispatch])

  const threads_by_anchor = useMemo(
    () => groupThreadsByAnchor(review?.threads ?? []),
    [review?.threads],
  )
  // The order is set here, not in the sidebar. Thus the tree and the diffs below
  // it are one list, in the same order.
  const files = useMemo(() => orderFilesByTree(diff_query.data ?? []), [diff_query.data])
  const paths = useMemo(() => files.map((file) => file.path), [files])
  const active_path = useActiveFile(paths)

  const local = useAppSelector((state) => localFor(state.local_reviews, review_id))
  const files_by_path = useMemo(() => new Map(files.map((file) => [file.path, file])), [files])
  const drafting: Drafting = useMemo(
    () => ({
      review_id,
      in_progress: local.drafts.length > 0,
      ...groupDrafts(local.drafts, files_by_path),
    }),
    [review_id, local.drafts, files_by_path],
  )
  const folded = useMemo(() => new Set(local.folded), [local.folded])
  const reviewed = useMemo(
    () =>
      new Set(
        files
          .filter((file) => {
            const blob = reviewBlob(file)
            return blob !== null && isReviewed(local, file.path, blob)
          })
          .map((file) => file.path),
      ),
    [files, local],
  )

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

  const held = local.drafts.length

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
          {repositoryName(review.repo_path)} ·{' '}
          {review.head_branch === null ? '' : `${review.head_branch} · `}
          {describeRange(review)} · round {review.rounds.length} · {relativeTime(review.created_at)}
        </span>
        <span className={styles.spacer} />
        <span className={styles.badge}>
          {open_count} open / {review.threads.length}
        </span>
        <Button tone="primary" onClick={() => setSubmitting(!submitting)}>
          {submitting ? 'Cancel' : submitted ? 'Submit again' : 'Submit review'}
          {!submitting && held > 0 && ` (${held})`}
        </Button>
      </header>

      {submission !== null && (
        <div
          className={[styles.verdict_banner, VERDICT_CLASS[submission.verdict]]
            .filter(Boolean)
            .join(' ')}
        >
          <div className={styles.verdict_label}>
            {VERDICT_LABEL[submission.verdict]}
            {submissionAuthor(submission) === 'reviewer' &&
              ` · by ${describeAuthor('reviewer', submission.author_name)}`}{' '}
            · {relativeTime(submission.created_at)}
          </div>
          {submission.body !== null && <div className={styles.verdict_body}>{submission.body}</div>}

          {submission.comments.map((comment) => (
            <div key={comment.id} className={styles.verdict_reply}>
              <AuthorLabel author={comment.author} author_name={comment.author_name} />
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

      {hasAiReview(review) && <ReviewHistoryPanel review={review} />}

      {submitting && (
        <SubmitPanel
          review={review}
          files={files_by_path}
          drafts={local.drafts}
          summary={summary}
          onSummaryChange={setSummary}
          onDone={() => setSubmitting(false)}
        />
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
              folded={folded}
              reviewed={reviewed}
              onSelect={scrollToFile}
              onToggleDirectory={(path) => dispatch(directoryToggled({ review_id, path }))}
            />
          </aside>

          <div className={styles.diffs}>
            {files.map((file) => {
              const blob = reviewBlob(file)
              return (
                <DiffFile
                  key={file.path}
                  review_id={review_id}
                  file={file}
                  threads={review.threads}
                  threads_by_anchor={threads_by_anchor}
                  drafting={drafting}
                  composing={composing}
                  reviewed={reviewed.has(file.path)}
                  can_review={blob !== null}
                  onComposingChange={setComposing}
                  onReviewedChange={(next) =>
                    dispatch(
                      fileReviewedSet({
                        review_id,
                        path: file.path,
                        blob_sha: next ? blob : null,
                      }),
                    )
                  }
                />
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
