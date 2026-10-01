import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './button'
import styles from './confirm-dialog.module.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirm_label: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before something that cannot be undone, saying what will be lost.
 *
 * A native `<dialog>` opened as a modal, which keeps focus inside it, closes on
 * Escape and makes the page behind it inert — none of which then needs doing by
 * hand. Cancel takes the initial focus, so a stray Enter keeps things as they
 * are.
 */
export const ConfirmDialog = ({
  open,
  title,
  children,
  confirm_label,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        // Escape: let React's state close it, so the two never disagree.
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 id="confirm-dialog-title" className={styles.title}>
        {title}
      </h2>
      <div className={styles.body}>{children}</div>
      <div className={styles.actions}>
        <Button autoFocus onClick={onCancel}>
          Cancel
        </Button>
        <Button tone="danger" onClick={onConfirm}>
          {confirm_label}
        </Button>
      </div>
    </dialog>
  )
}
