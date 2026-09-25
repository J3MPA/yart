import type { ReviewProgress, ReviewVerdict } from '@yart/core'

/** Enough of a hash to be recognisable, which is all a list needs. */
export const shortSha = (sha: string): string => sha.slice(0, 8)

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago, in words.
 *
 * A list of reviews is scanned rather than read, and "3 minutes ago" answers
 * "is this the one I just opened?" far faster than a timestamp does.
 */
export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown'

  const elapsed = now - then
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(elapsed / DAY)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * How a review's range reads in a list.
 *
 * A snapshot has a tree hash for a head, which means nothing to a person, so it
 * says what it actually is.
 */
export const describeRange = (review: {
  base_sha: string
  head_sha: string
  head_is_snapshot: boolean
}): string =>
  `${shortSha(review.base_sha)}..${review.head_is_snapshot ? 'working tree' : shortSha(review.head_sha)}`

export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
}

/**
 * What the agent has done since the review was handed back, in a few words.
 *
 * Null while nothing has happened. A badge that is always there is not a
 * signal, and the point of this one is to be worth glancing at.
 */
export const describeProgress = (progress: ReviewProgress | null): string | null => {
  if (progress === null || progress.state === 'idle') return null
  if (progress.state === 'ready') return 'ready for re-review'

  const total = progress.answered_threads + progress.awaiting_threads
  // Changes with nothing answered yet is the one case a ratio describes badly:
  // "0 of 3 answered" reads as stalled when work has in fact started.
  if (progress.answered_threads === 0) return 'changes started'
  return `${progress.answered_threads} of ${total} answered`
}
