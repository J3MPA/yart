import { useEffect, useRef } from 'react'
import type { Unseen } from './use-unseen'

/** What the desktop app's preload puts on the page; absent in a browser. */
interface DesktopBridge {
  unseenChanged(count: number): void
  notify(notice: { review_id: string; title: string }): void
}

declare global {
  interface Window {
    yart_desktop?: DesktopBridge
  }
}

/**
 * The reviews that have turned unseen since the last look.
 *
 * Null before there is a last look, so that opening the app does not announce
 * every review that was already waiting — the badge says how many there are.
 */
export const newlyUnseen = (
  before: ReadonlySet<string> | null,
  now: ReadonlySet<string>,
): string[] => (before === null ? [] : [...now].filter((id) => !before.has(id)))

/**
 * Carries the unseen count to the dock, and raises a notification when the agent
 * answers on a review.
 *
 * Not while the window has focus: whoever is looking at yart sees the dot in the
 * list, and a banner on top of it is noise.
 */
export const useDesktopSignal = (unseen: Unseen): void => {
  const before = useRef<ReadonlySet<string> | null>(null)

  useEffect(() => {
    window.yart_desktop?.unseenChanged(unseen.count)
  }, [unseen.count])

  useEffect(() => {
    // Before the list arrives nothing is unseen, and taking that as the first
    // look would announce everything already waiting the moment it did.
    if (!unseen.loaded) return
    const bridge = window.yart_desktop
    const fresh = newlyUnseen(before.current, unseen.ids)
    before.current = unseen.ids
    if (bridge === undefined || document.hasFocus()) return
    for (const review_id of fresh) {
      const title = unseen.titles.get(review_id)
      if (title !== undefined) bridge.notify({ review_id, title })
    }
  }, [unseen])
}
