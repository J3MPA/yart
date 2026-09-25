import { useState } from 'react'
import type { Thread } from '@yart/core'
import { Button } from '@/components/button'
import { useAppDispatch } from '@/store/hooks'
import { CommentForm } from './comment-form'
import { DraftComment } from './draft-comment'
import { newReplyDraft, type Drafting } from './drafts'
import { draftAdded } from './local-review-slice'
import { useAddCommentMutation, useSetThreadStatusMutation } from './review-api'
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
          onClick={() =>
            void setThreadStatus({
              review_id,
              thread_id: thread.id,
              status: resolved ? 'open' : 'resolved',
            })
          }
        >
          {resolved ? 'Reopen' : 'Resolve'}
        </Button>
      </div>

      {thread.comments.map((comment) => (
        <div key={comment.id} className={styles.comment}>
          <div className={styles.comment_author}>{comment.author}</div>
          <div className={styles.comment_body}>{comment.body}</div>
        </div>
      ))}

      {held.map((draft) => (
        <DraftComment key={draft.id} review_id={review_id} draft={draft} />
      ))}

      {replying ? (
        <CommentForm
          placeholder="Reply"
          submit_label="Reply now"
          queue_label={drafting.in_progress ? 'Add to review' : 'Start a review'}
          pending={add_state.isLoading}
          onCancel={() => setReplying(false)}
          onQueue={(body) => {
            dispatch(draftAdded({ review_id, draft: newReplyDraft(thread.id, body) }))
            setReplying(false)
          }}
          onSubmit={(body) => {
            void addComment({ review_id, thread_id: thread.id, body })
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
