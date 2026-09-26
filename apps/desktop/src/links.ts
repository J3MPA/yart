export const SCHEME = 'yart'

/**
 * Matched against the link as written rather than parsed as a URL, which
 * would resolve `..` segments before the id could be checked.
 */
const REVIEW_LINK = new RegExp(`^${SCHEME}://reviews/([A-Za-z0-9-]+)/?(?:[?#].*)?$`)

/**
 * The review a `yart://reviews/<id>` link points at, or null for anything else.
 *
 * The id goes into a path the window loads, so it is held to the characters a
 * review id is made of: a link is something any program on the machine can
 * hand the app.
 */
export const reviewIdFromLink = (link: string): string | null => REVIEW_LINK.exec(link)?.[1] ?? null
