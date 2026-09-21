/**
 * The DOM id of a file's section in the diff.
 *
 * A path is not safe to use as a URL fragment — it can hold characters a
 * fragment would have to escape — so the sidebar scrolls the element into view
 * by id instead of linking to it, and this is the name both sides agree on.
 */
export const fileAnchorId = (path: string): string => `file:${path}`

/** Brings a file's section into view, if the diff has rendered it. */
export const scrollToFile = (path: string): void => {
  document.getElementById(fileAnchorId(path))?.scrollIntoView({ block: 'start' })
}
