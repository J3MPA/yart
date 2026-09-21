import { useEffect, useState } from 'react'
import { activeFile, READING_LINE, type FilePosition } from './active-file'
import { fileAnchorId } from './file-anchors'

/**
 * Tracks which file the page is showing, for the sidebar to mark.
 *
 * Measured from the sections themselves on every scroll rather than kept in
 * sync as they change: a run of context opening mid-page moves everything
 * below it, and any bookkeeping of where files were would be wrong the moment
 * it happened. A `ResizeObserver` covers exactly that case, since expanding a
 * run resizes a section without scrolling anything.
 *
 * `paths` must be stable between renders, or the listeners are torn down and
 * rebuilt on each one.
 */
export const useActiveFile = (paths: readonly string[]): string | null => {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (paths.length === 0) {
      setActive(null)
      return
    }

    const elements = paths
      .map((path) => ({ path, element: document.getElementById(fileAnchorId(path)) }))
      .filter((entry): entry is { path: string; element: HTMLElement } => entry.element !== null)

    let frame = 0

    const measure = () => {
      frame = 0
      const positions: FilePosition[] = elements.map(({ path, element }) => ({
        path,
        top: element.getBoundingClientRect().top,
      }))
      setActive(activeFile(positions, window.innerHeight * READING_LINE))
    }

    // Scrolling fires far faster than the page can be repainted, so the
    // measurement is taken once per frame rather than once per event.
    const schedule = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    for (const { element } of elements) observer.observe(element)

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [paths])

  return active
}
