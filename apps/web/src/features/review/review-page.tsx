import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { agentActivity, describeAuthor, latestSubmission } from '@yart/core'
import type { ReviewVerdict } from '@yart/core'
import { attachmentIds, AttachmentList } from './attachments'
import { Button } from '@/components/button'
import { ReviewerIcon } from '@/components/reviewer-icon'
import { aiPhase, personSubmittedOnHead } from './ai-review'
import { AuthorLabel } from './author-label'
import { historyOpens, showsHistory } from './review-history'
import { ReviewHistoryPanel } from './review-history-panel'
import { ReviewDescription } from './review-description'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { CommentForm } from './comment-form'
import { unsentKey } from './unsent'
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
import {
  describeAiVerdict,
  describeRange,
  relativeTime,
  repositoryName,
  VERDICT_LABEL,
} from './format'
import {
  useAddSubmissionCommentMutation,
  useGetReviewDiffQuery,
  useGetReviewDiffSinceQuery,
  useGetReviewQuery,
} from './review-api'
import { defaultRange, headSideOnly, roundOf, sinceHead, type DiffRange } from './round-range'
import { describeQueryError } from './query-error'
import { countOpen, groupThreadsByAnchor } from './thread-anchors'
import { useAiRoundLimit } from './use-ai-round-limit'
import { MarkdownBody } from './markdown-body'
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
  const round_limit = useAiRoundLimit()

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

  // The diff can show only the work after an earlier round. The page keeps the
  // first choice. Without this, the page would change the view under the person
  // when they submit a verdict.
  const since_sha = review === undefined ? null : sinceHead(review)
  const [range_choice, setRangeChoice] = useState<DiffRange | null>(null)
  useEffect(() => {
    if (review !== undefined && range_choice === null) setRangeChoice(defaultRange(review))
  }, [review, range_choice])
  const range: DiffRange =
    since_sha === null
      ? 'all'
      : (range_choice ?? (review === undefined ? 'all' : defaultRange(review)))
  const since_query = useGetReviewDiffSinceQuery(
    { review_id, since: since_sha ?? '' },
    { skip: since_sha === null },
  )
  const since_files = useMemo(() => orderFilesByTree(since_query.data ?? []), [since_query.data])
  const changed = useMemo(() => new Set(since_files.map((file) => file.path)), [since_files])
  const shown = range === 'since' ? since_files : files
  const paths = useMemo(() => shown.map((file) => file.path), [shown])
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

  if (
    review_query.isLoading ||
    diff_query.isLoading ||
    (range === 'since' && since_query.isLoading)
  ) {
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
  const submitted = personSubmittedOnHead(review)
  // The banner shows the latest verdict, also after the agent moved the review.
  // The answer of the agent to it is often the summary of the new round.
  const submission = latestSubmission(review)
  const earlier_round =
    submission !== null && submission.head_sha !== review.head_sha
      ? review.rounds.indexOf(submission.head_sha) + 1
      : null
  const phase = aiPhase(review, round_limit)

  const held = local.drafts.length
  const diff_error = range === 'since' ? since_query.error : diff_query.error
  // In the view of the new work, the base side of a row is a line of an earlier
  // round. Thus only the anchors on the head side can show there.
  const shown_threads = range === 'since' ? headSideOnly(threads_by_anchor) : threads_by_anchor
  const shown_drafting: Drafting =
    range === 'since' ? { ...drafting, by_anchor: headSideOnly(drafting.by_anchor) } : drafting
  const tab = (value: DiffRange) =>
    [styles.tab, range === value ? styles.tab_selected : ''].filter(Boolean).join(' ')

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
        {since_sha !== null && (
          <div
            className={[styles.list_tabs, styles.range_tabs].join(' ')}
            role="group"
            aria-label="Which changes to show"
          >
            <button
              type="button"
              className={tab('all')}
              aria-pressed={range === 'all'}
              onClick={() => setRangeChoice('all')}
            >
              All changes
            </button>
            <button
              type="button"
              className={tab('since')}
              aria-pressed={range === 'since'}
              onClick={() => setRangeChoice('since')}
            >
              Since round {roundOf(review, since_sha)}
            </button>
          </div>
        )}
        <span className={styles.spacer} />
        <span className={styles.badge}>
          {open_count} open / {review.threads.length}
        </span>
        <Button tone="primary" onClick={() => setSubmitting(!submitting)}>
          {submitting ? 'Cancel' : submitted ? 'Submit again' : 'Submit review'}
          {!submitting && held > 0 && ` (${held})`}
        </Button>
      </header>

      <ReviewDescription review={review} />

      {submission !== null && (
        <div
          className={[
            styles.verdict_banner,
            phase === null ? VERDICT_CLASS[submission.verdict] : styles.verdict_ai,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {phase === null ? (
            <div className={styles.verdict_label}>
              {earlier_round !== null && earlier_round > 0 && `Round ${earlier_round} · `}
              {VERDICT_LABEL[submission.verdict]} · {relativeTime(submission.created_at)}
            </div>
          ) : (
            <>
              <div className={styles.verdict_label}>
                <ReviewerIcon />
                AI {describeAuthor('reviewer', phase.author_name)} ·{' '}
                {relativeTime(submission.created_at)}
              </div>
              <div className={styles.verdict_next}>{describeAiVerdict(phase)}</div>
            </>
          )}
          {submission.body !== null && (
            <div className={styles.verdict_body}>
              <MarkdownBody text={submission.body} />
            </div>
          )}
          <AttachmentList review_id={review_id} attachments={submission.attachments} />

          {submission.comments.map((comment) => (
            <div key={comment.id} className={styles.verdict_reply}>
              <AuthorLabel author={comment.author} author_name={comment.author_name} />
              <MarkdownBody text={comment.body} />
              <AttachmentList review_id={review_id} attachments={comment.attachments} />
            </div>
          ))}

          {answering ? (
            <div className={styles.verdict_form}>
              <CommentForm
                review_id={review_id}
                placeholder="Reply to this verdict"
                submit_label="Reply"
                pending={answer_state.isLoading}
                unsent_key={unsentKey(review_id, `answer ${submission.id}`)}
                onCancel={() => setAnswering(false)}
                onSubmit={async (body, attachments) => {
                  await addSubmissionComment({
                    review_id,
                    submission_id: submission.id,
                    body,
                    attachments: attachmentIds(attachments),
                  }).unwrap()
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

      {showsHistory(review) && <ReviewHistoryPanel review={review} open={historyOpens(review)} />}

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

      {diff_error !== undefined ? (
        <p className={styles.notice}>
          Could not load the diff: {describeQueryError(diff_error).message}
        </p>
      ) : (
        shown.length === 0 && <p className={styles.notice}>Nothing changed in this range.</p>
      )}

      {shown.length > 0 && (
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <FileSidebar
              files={shown}
              threads={review.threads}
              active_path={active_path}
              folded={folded}
              reviewed={reviewed}
              changed={range === 'all' ? changed : new Set()}
              onSelect={scrollToFile}
              onToggleDirectory={(path) => dispatch(directoryToggled({ review_id, path }))}
            />
          </aside>

          <div className={styles.diffs}>
            {shown.map((file) => {
              const blob = reviewBlob(file)
              return (
                <DiffFile
                  key={file.path}
                  review_id={review_id}
                  file={file}
                  threads={review.threads}
                  threads_by_anchor={shown_threads}
                  drafting={shown_drafting}
                  composing={composing}
                  reviewed={reviewed.has(file.path)}
                  can_review={blob !== null}
                  since={range === 'since' ? since_sha : null}
                  changed_in_round={range === 'all' && changed.has(file.path)}
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
