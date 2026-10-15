import { useEffect, useState, type KeyboardEvent } from 'react'
import type { Attachment } from '@yart/core'
import { Button } from '@/components/button'
import { AttachButton, AttachmentList, useImageAttachments } from './attachments'
import attachment_styles from './attachments.module.css'
import { describeQueryError, type QueryError } from './query-error'
import { readUnsent, writeUnsent } from './unsent'
import styles from './review.module.css'

/**
 * Sends or holds a comment. A promise that rejects keeps the form open with its
 * text, and the form shows the error.
 */
export type CommentAction = (body: string, attachments: Attachment[]) => void | Promise<void>

export interface CommentFormProps {
  /** The review that keeps the images of the comment. */
  review_id: string
  placeholder?: string
  submit_label?: string
  initial_body?: string
  initial_attachments?: readonly Attachment[]
  pending?: boolean
  /**
   * The key of the unsent text of this form, from `unsentKey`. With it, the form
   * keeps its text when it closes before a send, and takes it back when it opens.
   */
  unsent_key?: string
  onSubmit: (body: string, attachments: Attachment[]) => void | Promise<void>
  /**
   * Holds the comment for the pending review, and does not send it.
   *
   * When it is given, this becomes the main action, and Cmd+Enter does it, as on
   * GitHub. You draft a review, you do not dictate it. Thus to hold a comment is
   * the usual case, and to send one alone is the exception.
   */
  onQueue?: (body: string, attachments: Attachment[]) => void | Promise<void>
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
  unsent_key,
  onSubmit,
  onQueue,
  queue_label = 'Add to review',
  onCancel,
}: CommentFormProps) => {
  const [unsent] = useState(() => (unsent_key === undefined ? null : readUnsent(unsent_key)))
  const [body, setBody] = useState(unsent?.body ?? initial_body)
  const images = useImageAttachments(review_id, unsent?.attachments ?? initial_attachments)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const can_submit = body.trim() !== '' && !pending && !sending && !images.uploading

  useEffect(() => {
    if (unsent_key !== undefined) writeUnsent(unsent_key, { body, attachments: images.attachments })
  }, [unsent_key, body, images.attachments])

  const run = async (action: CommentAction) => {
    if (!can_submit) return
    setError(null)
    setSending(true)
    try {
      await action(body.trim(), images.attachments)
    } catch (cause) {
      setError(
        `The comment was not sent: ${describeQueryError(cause as QueryError).message} ` +
          'Your text is still here.',
      )
      setSending(false)
      return
    }
    if (unsent_key !== undefined) writeUnsent(unsent_key, null)
    setSending(false)
    setBody('')
    images.clear()
  }

  const primary = onQueue ?? onSubmit

  // Cmd/Ctrl+Enter does the main action, because the hands of a reviewer are
  // already on the keyboard.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void run(primary)
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
      {error !== null && (
        <p className={attachment_styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.form_actions}>
        {onQueue === undefined ? (
          <Button tone="primary" disabled={!can_submit} onClick={() => void run(onSubmit)}>
            {pending || sending ? 'Saving…' : submit_label}
          </Button>
        ) : (
          <>
            <Button tone="primary" disabled={!can_submit} onClick={() => void run(onQueue)}>
              {queue_label}
            </Button>
            <Button disabled={!can_submit} onClick={() => void run(onSubmit)}>
              {pending || sending ? 'Saving…' : submit_label}
            </Button>
          </>
        )}
        {onCancel !== undefined && <Button onClick={onCancel}>Cancel</Button>}
        <span className={styles.spacer} />
        <span className={styles.markdown_note}>Markdown is supported</span>
        <AttachButton disabled={pending} onFiles={(files) => void images.add(files)} />
      </div>
    </div>
  )
}
