/**
 * How much of each review this person has already looked at.
 *
 * Seen-ness is per person and per device rather than a property of the review,
 * so it lives in the browser and never reaches the daemon — which also keeps an
 * agent from being able to mark its own work as read.
 *
 * The value stored against a review is `agentActivity` as it stood when the
 * review was last on screen, so "unseen" means the agent has done something
 * since. Storage can be absent or throw in a private window, so every access is
 * guarded and a failure degrades to showing no dot rather than to a blank page.
 */
const KEY = 'yart.seen-activity.v1'

export type SeenActivity = Readonly<Record<string, number>>

export const readSeen = (): SeenActivity => {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as SeenActivity
  } catch {
    return {}
  }
}

export const writeSeen = (seen: SeenActivity): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {
    // A person who has turned storage off gets no dot, which is better than
    // a page that will not render.
  }
}

/**
 * Records a review as seen up to its current activity.
 *
 * Returns the new map, or null when nothing changed — so a caller can skip a
 * write and a re-render on every poll of a review nobody has touched.
 */
export const markSeen = (
  seen: SeenActivity,
  review_id: string,
  activity: number,
): SeenActivity | null => {
  if (seen[review_id] === activity) return null
  return { ...seen, [review_id]: activity }
}

/**
 * Drops reviews that are no longer listed.
 *
 * Without this the map grows for as long as the browser profile lives, keeping
 * a number against every review ever deleted.
 */
export const forgetMissing = (seen: SeenActivity, live_ids: Iterable<string>): SeenActivity => {
  const live = new Set(live_ids)
  const kept: Record<string, number> = {}
  for (const [id, activity] of Object.entries(seen)) {
    if (live.has(id)) kept[id] = activity
  }
  return kept
}

/**
 * Whether a review has moved since it was last looked at.
 *
 * A review with no entry is not unseen: it has never been opened, so there is
 * no "since" to measure from, and a list where everything shouts says nothing.
 */
export const isUnseen = (seen: SeenActivity, review_id: string, activity: number): boolean => {
  const mark = seen[review_id]
  return mark !== undefined && activity > mark
}
