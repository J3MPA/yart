export const SCHEME = 'yart'

/**
 * The pattern looks at the link as it is written. It does not read the link as
 * a URL, because a URL parser removes `..` segments before the id check.
 */
const REVIEW_LINK = new RegExp(`^${SCHEME}://reviews/([A-Za-z0-9-]+)/?(?:[?#].*)?$`)

/** The characters of a review id. Only these go into a path that the window loads. */
export const REVIEW_ID = /^[A-Za-z0-9-]+$/

/**
 * The review that a `yart://reviews/<id>` link points to, or null for all other
 * links.
 *
 * The id goes into a path that the window loads. Thus it can contain only the
 * characters of a review id. Any program on the computer can give a link to the
 * app.
 */
export const reviewIdFromLink = (link: string): string | null => REVIEW_LINK.exec(link)?.[1] ?? null
