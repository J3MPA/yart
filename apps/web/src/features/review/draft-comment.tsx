import { useState } from 'react'
import { Button } from '@/components/button'
import { useAppDispatch } from '@/store/hooks'
import { AttachmentList } from './attachments'
import { CommentForm } from './comment-form'
import type { Draft } from './local-review-state'
import { draftDropped, draftEdited } from './local-review-slice'
import { MarkdownBody } from './markdown-body'
import styles from './review.module.css'

export interface DraftCommentProps {
  review_id: string
  draft: Draft
}

/** A comment held for the pending review. Only its author sees it, and can still edit it. */
export const DraftComment = ({ review_id, draft }: DraftCommentProps) => {
  const dispatch = useAppDispatch()
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <CommentForm
        review_id={review_id}
        initial_body={draft.body}
        initial_attachments={draft.attachments}
        submit_label="Save"
        onSubmit={(body, attachments) => {
          dispatch(draftEdited({ review_id, draft_id: draft.id, body, attachments }))
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className={styles.draft}>
      <div className={styles.thread_meta}>
        <span className={styles.draft_label}>Pending</span>
        <span className={styles.spacer} />
        <Button tone="quiet" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          tone="quiet"
          onClick={() => dispatch(draftDropped({ review_id, draft_id: draft.id }))}
        >
          Drop
        </Button>
      </div>
      <MarkdownBody text={draft.body} />
      <AttachmentList review_id={review_id} attachments={draft.attachments} />
    </div>
  )
}
