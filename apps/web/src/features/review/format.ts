import { latestSubmission, reviewProgress } from '@yart/core'
import type { Review, ReviewVerdict } from '@yart/core'

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

export type StatusTone = 'plain' | 'approved' | 'changes' | 'working' | 'ready'

export interface ReviewStatus {
  label: string
  tone: StatusTone
  /** The detail behind the label, for a tooltip; null when the label is all there is. */
  detail: string | null
}

/**
 * Where a review stands, as one label.
 *
 * The verdict and the agent's progress used to be two badges, but they are one
 * fact read at different moments: a verdict is given, then the agent responds
 * to it. Once the agent has moved, what you decided matters less than whose
 * turn it is — and the verdict is at the top of the page you are about to open.
 *
 * Built from the latest verdict rather than the current head's, because an
 * agent advancing the review is exactly when this should change, and the
 * current head has no verdict yet at that point.
 */
export const describeStatus = (review: Review): ReviewStatus => {
  const progress = reviewProgress(review)
  const submission = latestSubmission(review)

  if (progress === null || submission === null) {
    return { label: 'open', tone: 'plain', detail: null }
  }

  const total = progress.answered_threads + progress.awaiting_threads
  const answered = total === 0 ? null : `${progress.answered_threads} of ${total} comments answered`

  if (progress.state === 'ready') return { label: 'your turn', tone: 'ready', detail: answered }
  if (progress.state === 'in_progress') {
    return { label: 'agent working', tone: 'working', detail: answered }
  }

  const tone: StatusTone =
    submission.verdict === 'approved'
      ? 'approved'
      : submission.verdict === 'changes_requested'
        ? 'changes'
        : 'plain'
  return { label: VERDICT_LABEL[submission.verdict], tone, detail: null }
}
