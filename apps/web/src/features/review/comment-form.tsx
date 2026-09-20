import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/button'
import styles from './review.module.css'

export interface CommentFormProps {
  placeholder?: string
  submit_label?: string
  pending?: boolean
  onSubmit: (body: string) => void
  onCancel?: () => void
}

export const CommentForm = ({
  placeholder = 'Leave a comment',
  submit_label = 'Comment',
  pending = false,
  onSubmit,
  onCancel,
}: CommentFormProps) => {
  const [body, setBody] = useState('')
  const can_submit = body.trim() !== '' && !pending

  const submit = () => {
    if (!can_submit) return
    onSubmit(body.trim())
    setBody('')
  }

  // Cmd/Ctrl+Enter submits, because a reviewer's hands are already on the keyboard.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
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
        <Button tone="primary" disabled={!can_submit} onClick={submit}>
          {pending ? 'Saving…' : submit_label}
        </Button>
        {onCancel !== undefined && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  )
}
