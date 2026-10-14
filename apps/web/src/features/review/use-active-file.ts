import { useEffect, useState } from 'react'
import { activeFile, READING_LINE, type FilePosition } from './active-file'
import { fileAnchorId } from './file-anchors'

/**
 * Finds the file that the page shows, for the sidebar to mark.
 *
 * The hook measures the sections themselves on each scroll. It does not keep a
 * record of the positions. A run of context that opens in the middle of the page
 * moves all that is below it, and a record would then be wrong at once. A
 * `ResizeObserver` covers that case, because a run that opens changes the size
 * of a section and does not scroll.
 *
 * `paths` must not change between renders. Otherwise the hook removes and adds
 * the listeners again on each render.
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

    // Scroll events come much faster than the page can paint again. Thus the hook
    // measures one time for each frame, not one time for each event.
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
