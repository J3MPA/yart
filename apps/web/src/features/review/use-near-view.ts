import { useEffect, useState, type RefObject } from 'react'

/**
 * How far outside the viewport counts as near: approximately two screens. Thus a
 * file gets its colors before you scroll to it, not while you scroll to it.
 */
export const NEAR_VIEW_MARGIN_PX = 1600

/**
 * Tells if an element came near the viewport. When it is true, it stays true.
 * The action that it controls, to get and color a file, occurs one time.
 *
 * It is true from the start when there is no `IntersectionObserver`. Thus the
 * page does not hold back anything when the observer is missing.
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
