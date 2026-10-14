/**
 * The DOM id of the section of a file in the diff.
 *
 * A path is not safe as a URL fragment. It can hold characters that a fragment
 * must escape. Thus the sidebar scrolls to the element by its id, and does not
 * link to it. This is the name that the two sides use.
 */
export const fileAnchorId = (path: string): string => `file:${path}`

/** Scrolls to the section of a file, if the diff shows it. */
export const scrollToFile = (path: string): void => {
  document.getElementById(fileAnchorId(path))?.scrollIntoView({ block: 'start' })
}
