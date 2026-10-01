import { useEffect, useState, type RefObject } from 'react'

/**
 * How far outside the viewport counts as near: a couple of screens, so that a
 * file is coloured before it scrolls into sight rather than as it does.
 */
export const NEAR_VIEW_MARGIN_PX = 1600

/**
 * Whether an element has come near the viewport. Once true it stays true, since
 * what it gates — fetching and colouring a file — is done once and kept.
 *
 * True from the start where there is no `IntersectionObserver` to ask, so that
 * nothing is withheld for want of one.
 */
export const useNearView = (
  ref: RefObject<Element | null>,
  margin_px: number = NEAR_VIEW_MARGIN_PX,
): boolean => {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const element = ref.current
    if (near || element === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention -- the DOM's option name
      { rootMargin: `${margin_px}px 0px` },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, near, margin_px])

  return near
}
