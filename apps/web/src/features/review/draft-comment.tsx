import { useState } from 'react'
import { Button } from '@/components/button'
import { useAppDispatch } from '@/store/hooks'
import { CommentForm } from './comment-form'
import type { Draft } from './local-review-state'
import { draftDropped, draftEdited } from './local-review-slice'
import styles from './review.module.css'

export interface DraftCommentProps {
  review_id: string
  draft: Draft
}

/** A comment held for the pending review: seen only by its author, still editable. */
export const DraftComment = ({ review_id, draft }: DraftCommentProps) => {
  const dispatch = useAppDispatch()
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <CommentForm
        initial_body={draft.body}
        submit_label="Save"
        onSubmit={(body) => {
          dispatch(draftEdited({ review_id, draft_id: draft.id, body }))
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
      <div className={styles.comment_body}>{draft.body}</div>
    </div>
  )
}
