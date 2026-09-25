import type { Thread } from './types.ts'
import type { Review, ReviewSubmission } from './review.ts'

/**
 * The verdict passed on the review's current head, if this round has been
 * handed back.
 *
 * Scoped to the current head on purpose: once the agent advances the review,
 * an earlier approval no longer describes what is on screen.
 */
export const currentSubmission = (review: Review): ReviewSubmission | null => {
  for (let index = review.submissions.length - 1; index >= 0; index -= 1) {
    const submission = review.submissions[index] as ReviewSubmission
    if (submission.head_sha === review.head_sha) return submission
  }
  return null
}

/** The most recent verdict, whichever head it was passed on. */
export const latestSubmission = (review: Review): ReviewSubmission | null =>
  review.submissions[review.submissions.length - 1] ?? null

/**
 * Whether the agent has responded to a thread since the human last wrote on it.
 *
 * Resolving counts: an agent that marks a thread done has said what it has to
 * say about it. Otherwise this turns on who spoke last, because a human
 * replying to the agent's answer puts the thread back in the agent's court —
 * and a count that did not notice would report work as finished twice.
 */
export const threadIsAnswered = (thread: Thread): boolean => {
  if (thread.status === 'resolved') return true
  const last = thread.comments[thread.comments.length - 1]
  return last !== undefined && last.author === 'agent'
}

/**
 * How far the agent has got with a review that was handed back.
 *
 * - `idle` — nothing has happened since the verdict
 * - `in_progress` — answers or changes have appeared, but threads are still waiting
 * - `ready` — nothing is waiting on the agent; worth looking again
 */
export type ProgressState = 'idle' | 'in_progress' | 'ready'

export interface ReviewProgress {
  state: ProgressState
  answered_threads: number
  awaiting_threads: number
  /** Whether the head has moved since the verdict was passed. */
  code_changed: boolean
  /** Whether the agent has written back under the verdict itself. */
  summary_answered: boolean
}

/**
 * What has happened to a review since it was submitted, or null if it never was.
 *
 * The distinction worth drawing is between *something* happening and
 * *everything* having happened: the first says the agent has picked the review
 * up, the second says there is a point in opening it again. Anything less
 * specific and the signal has to be checked by hand, which is the work it was
 * supposed to save.
 *
 * `ready` deliberately does not require the code to have changed. An agent that
 * answers every comment by explaining why it disagrees has finished its turn
 * just as much as one that rewrote the file, and both need a human to look.
 */
export const reviewProgress = (review: Review): ReviewProgress | null => {
  const submission = latestSubmission(review)
  if (submission === null) return null

  let answered_threads = 0
  let awaiting_threads = 0
  for (const thread of review.threads) {
    if (threadIsAnswered(thread)) answered_threads += 1
    else awaiting_threads += 1
  }

  const code_changed = submission.head_sha !== review.head_sha
  const summary_answered = submission.comments.some((comment) => comment.author === 'agent')
  const stirred = answered_threads > 0 || code_changed || summary_answered

  const state: ProgressState = !stirred ? 'idle' : awaiting_threads === 0 ? 'ready' : 'in_progress'

  return { state, answered_threads, awaiting_threads, code_changed, summary_answered }
}
