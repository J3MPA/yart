import type { ReviewVerdict } from '@yart/core'

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

export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
}
