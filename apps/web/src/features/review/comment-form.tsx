import { useState, type KeyboardEvent } from 'react'
import type { Attachment } from '@yart/core'
import { Button } from '@/components/button'
import { AttachButton, AttachmentList, useImageAttachments } from './attachments'
import attachment_styles from './attachments.module.css'
import styles from './review.module.css'

export type CommentAction = (body: string, attachments: Attachment[]) => void

export interface CommentFormProps {
  /** The review that keeps the images of the comment. */
  review_id: string
  placeholder?: string
  submit_label?: string
  initial_body?: string
  initial_attachments?: readonly Attachment[]
  pending?: boolean
  onSubmit: (body: string, attachments: Attachment[]) => void
  /**
   * Holds the comment for the pending review, and does not send it.
   *
   * When it is given, this becomes the main action, and Cmd+Enter does it, as on
   * GitHub. You draft a review, you do not dictate it. Thus to hold a comment is
   * the usual case, and to send one alone is the exception.
   */
  onQueue?: (body: string, attachments: Attachment[]) => void
  queue_label?: string
  onCancel?: () => void
}

export const CommentForm = ({
  review_id,
  placeholder = 'Leave a comment',
  submit_label = 'Comment',
  initial_body = '',
  initial_attachments = [],
  pending = false,
  onSubmit,
  onQueue,
  queue_label = 'Add to review',
  onCancel,
}: CommentFormProps) => {
  const [body, setBody] = useState(initial_body)
  const images = useImageAttachments(review_id, initial_attachments)
  const can_submit = body.trim() !== '' && !pending && !images.uploading

  const run = (action: CommentAction) => {
    if (!can_submit) return
    action(body.trim(), images.attachments)
    setBody('')
    images.clear()
  }

  const primary = onQueue ?? onSubmit

  // Cmd/Ctrl+Enter does the main action, because the hands of a reviewer are
  // already on the keyboard.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      run(primary)
    }
    if (event.key === 'Escape' && onCancel !== undefined) onCancel()
  }

  return (
    <div className={styles.form} onDrop={images.onDrop} onDragOver={images.onDragOver}>
      <textarea
        className={styles.textarea}
        value={body}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={images.onPaste}
      />
      <AttachmentList
        review_id={review_id}
        attachments={images.attachments}
        onRemove={images.remove}
      />
      {images.error !== null && <p className={attachment_styles.error}>{images.error}</p>}
      <div className={styles.form_actions}>
        {onQueue === undefined ? (
          <Button tone="primary" disabled={!can_submit} onClick={() => run(onSubmit)}>
            {pending ? 'Saving…' : submit_label}
          </Button>
        ) : (
          <>
            <Button tone="primary" disabled={!can_submit} onClick={() => run(onQueue)}>
              {queue_label}
            </Button>
            <Button disabled={!can_submit} onClick={() => run(onSubmit)}>
              {pending ? 'Saving…' : submit_label}
            </Button>
          </>
        )}
        {onCancel !== undefined && <Button onClick={onCancel}>Cancel</Button>}
        <span className={styles.spacer} />
        <AttachButton disabled={pending} onFiles={(files) => void images.add(files)} />
      </div>
    </div>
  )
}
