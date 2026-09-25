import { useState } from 'react'
import type { Review, ReviewVerdict } from '@yart/core'
import { Button } from '@/components/button'
import { useAppDispatch } from '@/store/hooks'
import { describeDraft, isStale, type FileBlobs } from './drafts'
import type { Draft, ReplyDraft, ThreadDraft } from './local-review-state'
import { draftDropped, draftsSent } from './local-review-slice'
import { describeQueryError, type QueryError } from './query-error'
import { useSubmitReviewMutation } from './review-api'
import styles from './review.module.css'

export interface SubmitPanelProps {
  review: Review
  files: ReadonlyMap<string, FileBlobs>
  drafts: readonly Draft[]
  summary: string
  onSummaryChange: (summary: string) => void
  onDone: () => void
}

const staleWarning = (count: number): string =>
  count === 1
    ? 'One comment was written on a version of its file that has since changed, so its line ' +
      'may no longer be the one it was about. Drop it to submit.'
    : `${count} comments were written on versions of their files that have since changed, so ` +
      'their lines may no longer be the ones they were about. Drop them to submit.'

/** Where a review is finished: the summary, the verdict, and everything held for it. */
export const SubmitPanel = ({
  review,
  files,
  drafts,
  summary,
  onSummaryChange,
  onDone,
}: SubmitPanelProps) => {
  const dispatch = useAppDispatch()
  const [submitReview, submit_state] = useSubmitReviewMutation()
  const [error, setError] = useState<string | null>(null)

  const stale = drafts.filter((draft) => isStale(draft, files))
  const threads = drafts.filter(
    (draft): draft is ThreadDraft => draft.kind === 'thread' && !isStale(draft, files),
  )
  const replies = drafts.filter((draft): draft is ReplyDraft => draft.kind === 'reply')

  const submit = async (verdict: ReviewVerdict) => {
    setError(null)
    try {
      await submitReview({
        review_id: review.id,
        verdict,
        body: summary,
        threads: threads.map(({ path, side, line, body, blob_sha }) => ({
          path,
          side,
          line,
          body,
          blob_sha,
        })),
        replies: replies.map(({ thread_id, body }) => ({ thread_id, body })),
        expected_head_sha: review.head_sha,
      }).unwrap()
      // Only once the daemon has them: a draft is cleared by being sent, never
      // by being attempted, or a failed submit would lose what was written.
      dispatch(draftsSent(review.id))
      onSummaryChange('')
      onDone()
    } catch (cause) {
      setError(describeQueryError(cause as QueryError).message)
    }
  }

  const blocked = stale.length > 0 || submit_state.isLoading

  return (
    <div className={styles.submit_panel}>
      <div className={styles.submit_heading}>Finish your review</div>

      {drafts.length > 0 && (
        <div className={styles.pending_list}>
          <div className={styles.pending_heading}>
            {drafts.length} pending comment{drafts.length === 1 ? '' : 's'} will be sent with your
            review
          </div>
          {drafts.map((draft) => {
            const is_stale = isStale(draft, files)
            return (
              <div
                key={draft.id}
                className={[styles.pending_item, is_stale ? styles.pending_stale : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.pending_where}>{describeDraft(draft)}</span>
                <span className={styles.pending_body}>{draft.body}</span>
                <Button
                  tone="quiet"
                  onClick={() =>
                    dispatch(draftDropped({ review_id: review.id, draft_id: draft.id }))
                  }
                >
                  Drop
                </Button>
              </div>
            )
          })}
          {stale.length > 0 && (
            <p className={styles.pending_warning}>{staleWarning(stale.length)}</p>
          )}
        </div>
      )}

      <textarea
        className={styles.textarea}
        value={summary}
        placeholder="Summary (optional)"
        aria-label="Review summary"
        autoFocus
        onChange={(event) => onSummaryChange(event.target.value)}
      />

      {error !== null && <p className={styles.submit_error}>{error}</p>}

      <div className={styles.submit_actions}>
        <Button disabled={blocked} onClick={() => void submit('commented')}>
          Comment
        </Button>
        <Button tone="primary" disabled={blocked} onClick={() => void submit('approved')}>
          Approve
        </Button>
        <Button disabled={blocked} onClick={() => void submit('changes_requested')}>
          Request changes
        </Button>
      </div>
    </div>
  )
}
