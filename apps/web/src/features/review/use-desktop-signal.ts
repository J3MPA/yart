import { useEffect, useRef } from 'react'
import type { Unseen } from './use-unseen'

/** What the preload of the desktop app puts on the page. It is not there in a browser. */
interface DesktopBridge {
  unseenChanged(count: number): void
  notify(notice: { review_id: string; title: string }): void
  /** Asks the app to sign this window in again. An app from before sign-in does not have it. */
  signIn?(): void
}

declare global {
  interface Window {
    yart_desktop?: DesktopBridge
  }
}

/**
 * The reviews that started to wait on the person after the last look.
 *
 * Null before the first look. Thus the app does not announce each review that
 * already waited when it opens. The badge tells how many there are.
 */
export const newlyWaiting = (
  before: ReadonlySet<string> | null,
  now: ReadonlySet<string>,
): string[] => (before === null ? [] : [...now].filter((id) => !before.has(id)))

/**
 * Sends the unseen count to the dock, and shows a notification when a review
 * becomes the turn of the person.
 *
 * Only then. An answer of the agent to an AI reviewer, or a part of an answer,
 * does not need the person. The dot in the list shows it.
 *
 * Not while the window has focus. The person who looks at yart sees the dot in
 * the list, and a banner on top of it is noise.
 */
export const useDesktopSignal = (unseen: Unseen): void => {
  const before = useRef<ReadonlySet<string> | null>(null)
  const { loaded, waiting } = unseen

  useEffect(() => {
    window.yart_desktop?.unseenChanged(unseen.count)
  }, [unseen.count])

  useEffect(() => {
    // Before the list comes, nothing waits. If that were the first look, the
    // hook would announce each review that already waited when the list came.
    if (!loaded) return
    const bridge = window.yart_desktop
    const now = new Set(waiting.keys())
    const fresh = newlyWaiting(before.current, now)
    before.current = now
    if (bridge === undefined || document.hasFocus()) return
    for (const review_id of fresh) {
      const title = waiting.get(review_id)
      if (title !== undefined) bridge.notify({ review_id, title })
    }
  }, [loaded, waiting])
}
