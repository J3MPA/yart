import { latestSubmission, reviewProgress } from '@yart/core'
import type { Review, ReviewVerdict } from '@yart/core'

/** Sufficient characters of a hash to identify it, which is all that a list needs. */
export const shortSha = (sha: string): string => sha.slice(0, 8)

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago, in words.
 *
 * People look quickly at a list of reviews. They do not read it. "3 minutes ago"
 * answers "is this the review that I just opened?" much faster than a time.
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
 * How the range of a review shows in a list.
 *
 * The head of a snapshot is a tree hash, which means nothing to a person. Thus
 * the text says what it is.
 */
export const describeRange = (review: {
  base_sha: string
  head_sha: string
  head_is_snapshot: boolean
}): string =>
  `${shortSha(review.base_sha)}..${review.head_is_snapshot ? 'working tree' : shortSha(review.head_sha)}`

/**
 * A repository as a person names it: the last part of its path.
 *
 * The code divides the path itself, because this runs in the browser. There,
 * `node:path` does not exist, and Vite replaces it with an empty stub. The code
 * removes empty parts. Thus a slash at the end does not make the name empty.
 */
export const repositoryName = (repo_path: string): string =>
  repo_path.split(/[\\/]/).filter(Boolean).pop() ?? repo_path

export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
}

export type StatusTone = 'plain' | 'approved' | 'changes' | 'working' | 'ready'

export interface ReviewStatus {
  label: string
  tone: StatusTone
  /** The detail of the label, for a tooltip, or null when the label tells all. */
  detail: string | null
}

/**
 * The state of a review, as one label.
 *
 * Before, the verdict and the progress of the agent were two badges. But they
 * are one fact at different times. You give a verdict, and then the agent
 * responds. After the agent moves, whose turn it is is more important than
 * what you decided. The verdict is at the top of the page that you open.
 *
 * The label uses the latest verdict, not the verdict of the current head. The
 * label must change when the agent moves the review, and at that time the
 * current head has no verdict.
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
