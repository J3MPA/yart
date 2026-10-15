import { useState } from 'react'
import type { Thread } from '@yart/core'
import { Button } from '@/components/button'
import { attachmentIds, AttachmentList } from './attachments'
import { AuthorLabel } from './author-label'
import { useAppDispatch } from '@/store/hooks'
import { CommentForm } from './comment-form'
import { DraftComment } from './draft-comment'
import { newReplyDraft, type Drafting } from './drafts'
import { draftAdded } from './local-review-slice'
import { describeQueryError, type QueryError } from './query-error'
import { useAddCommentMutation, useSetThreadStatusMutation } from './review-api'
import { unsentKey } from './unsent'
import { MarkdownBody } from './markdown-body'
import styles from './review.module.css'

export interface CommentThreadProps {
  review_id: string
  thread: Thread
  drafting: Drafting
}

export const CommentThread = ({ review_id, thread, drafting }: CommentThreadProps) => {
  const dispatch = useAppDispatch()
  const [replying, setReplying] = useState(false)
  const [addComment, add_state] = useAddCommentMutation()
  const [setThreadStatus] = useSetThreadStatusMutation()
  const [status_error, setStatusError] = useState<string | null>(null)

  const resolved = thread.status === 'resolved'
  const held = drafting.by_thread.get(thread.id) ?? []

  return (
    <article
      className={[styles.thread, resolved ? styles.thread_resolved : ''].filter(Boolean).join(' ')}
    >
      <div className={styles.thread_meta}>
        {thread.anchor_state === 'shifted' && <span>moved from line {thread.origin.line}</span>}
        {resolved && <span>resolved</span>}
        <span className={styles.spacer} />
        <Button
          tone="quiet"
          onClick={() => {
            setStatusError(null)
            setThreadStatus({
              review_id,
              thread_id: thread.id,
              status: resolved ? 'open' : 'resolved',
            })
              .unwrap()
              .catch((cause: unknown) =>
                setStatusError(
                  `The thread was not ${resolved ? 'reopened' : 'resolved'}: ` +
                    describeQueryError(cause as QueryError).message,
                ),
              )
          }}
        >
          {resolved ? 'Reopen' : 'Resolve'}
        </Button>
      </div>
      {status_error !== null && (
        <p className={styles.submit_error} role="alert">
          {status_error}
        </p>
      )}

      {thread.comments.map((comment) => (
        <div key={comment.id} className={styles.comment}>
          <AuthorLabel author={comment.author} author_name={comment.author_name} />
          <MarkdownBody text={comment.body} />
          <AttachmentList review_id={review_id} attachments={comment.attachments} />
        </div>
      ))}

      {held.map((draft) => (
        <DraftComment key={draft.id} review_id={review_id} draft={draft} />
      ))}

      {replying ? (
        <CommentForm
          review_id={review_id}
          placeholder="Reply"
          submit_label="Reply now"
          queue_label={drafting.in_progress ? 'Add to review' : 'Start a review'}
          pending={add_state.isLoading}
          unsent_key={unsentKey(review_id, `reply ${thread.id}`)}
          onCancel={() => setReplying(false)}
          onQueue={(body, attachments) => {
            dispatch(draftAdded({ review_id, draft: newReplyDraft(thread.id, body, attachments) }))
            setReplying(false)
          }}
          onSubmit={async (body, attachments) => {
            await addComment({
              review_id,
              thread_id: thread.id,
              body,
              attachments: attachmentIds(attachments),
            }).unwrap()
            setReplying(false)
          }}
        />
      ) : (
        <div className={styles.form_actions}>
          <Button tone="quiet" onClick={() => setReplying(true)}>
            Reply
          </Button>
        </div>
      )}
    </article>
  )
}
