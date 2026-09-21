import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './menu.module.css'

export interface MenuProps {
  /** Announced to assistive technology, since the trigger is only an icon. */
  label: string
  /**
   * Called whenever the menu closes, however it closed.
   *
   * Anything the menu was part-way through — a confirmation waiting on a second
   * click — should be forgotten here, or it is still armed when the menu is
   * next opened.
   */
  onClose?: () => void
  children: (close: () => void) => ReactNode
}

/**
 * An overflow menu.
 *
 * Actions that are rarely wanted and hard to undo live behind this rather than
 * sitting in the row, where they compete with the thing the row is actually for.
 */
export const Menu = ({ label, onClose, children }: MenuProps) => {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  // Kept in a ref so the listener effect does not re-subscribe whenever the
  // caller passes a new closure.
  const on_close = useRef(onClose)
  on_close.current = onClose

  const close = useCallback(() => {
    setOpen(false)
    on_close.current?.()
  }, [])

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return (
    <div className={styles.container} ref={container}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div className={styles.sheet} role="menu">
          {children(close)}
        </div>
      )}
    </div>
  )
}

export interface MenuItemProps {
  onClick: () => void
  /** Styles the item as destructive, for actions that cannot be undone. */
  danger?: boolean
  children: ReactNode
}

export const MenuItem = ({ onClick, danger = false, children }: MenuItemProps) => (
  <button
    type="button"
    role="menuitem"
    className={[styles.item, danger ? styles.item_danger : ''].filter(Boolean).join(' ')}
    onClick={onClick}
  >
    {children}
  </button>
)
