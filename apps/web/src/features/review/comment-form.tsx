import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/button'
import styles from './review.module.css'

export interface CommentFormProps {
  placeholder?: string
  submit_label?: string
  initial_body?: string
  pending?: boolean
  onSubmit: (body: string) => void
  /**
   * Holds the comment for the pending review, and does not send it.
   *
   * When it is given, this becomes the main action, and Cmd+Enter does it, as on
   * GitHub. You draft a review, you do not dictate it. Thus to hold a comment is
   * the usual case, and to send one alone is the exception.
   */
  onQueue?: (body: string) => void
  queue_label?: string
  onCancel?: () => void
}

export const CommentForm = ({
  placeholder = 'Leave a comment',
  submit_label = 'Comment',
  initial_body = '',
  pending = false,
  onSubmit,
  onQueue,
  queue_label = 'Add to review',
  onCancel,
}: CommentFormProps) => {
  const [body, setBody] = useState(initial_body)
  const can_submit = body.trim() !== '' && !pending

  const run = (action: (body: string) => void) => {
    if (!can_submit) return
    action(body.trim())
    setBody('')
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
    <div className={styles.form}>
      <textarea
        className={styles.textarea}
        value={body}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
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
      </div>
    </div>
  )
}
