import { readStored, writeStored } from './browser-storage'

/**
 * How much of each review this person already saw.
 *
 * The seen state is for each person and each device. It is not a property of
 * the review. Thus it is in the browser, and never goes to the daemon. Thus an
 * agent also cannot mark its own work as read.
 *
 * The value for a review is its `agentActivity` at the time when the review was
 * last on the screen. Thus "unseen" means that the agent did something after
 * that time.
 */
const KEY = 'yart.seen-activity.v1'

export type SeenActivity = Readonly<Record<string, number>>

export const readSeen = (): SeenActivity => readStored<SeenActivity>(KEY, {})

export const writeSeen = (seen: SeenActivity): void => writeStored(KEY, seen)

/**
 * Records a review as seen, up to its current activity.
 *
 * Returns the new map, or null when nothing changed. Thus a caller can skip a
 * write and a new render on each poll of a review that nobody touched.
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
 * Removes the reviews that are not in the list now.
 *
 * Without this, the map grows for as long as the browser profile exists. It
 * would keep a number for each review that was ever deleted.
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
 * Tells if a review moved after the person last looked at it.
 *
 * A review with no entry is not unseen. Nobody opened it, thus there is no
 * "before" to compare with. Also, a list where all reviews show a dot gives no
 * information.
 */
export const isUnseen = (seen: SeenActivity, review_id: string, activity: number): boolean => {
  const mark = seen[review_id]
  return mark !== undefined && activity > mark
}
