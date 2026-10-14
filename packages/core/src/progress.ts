import type { Thread } from './types.ts'
import { submissionAuthor } from './authors.ts'
import type { Review, ReviewSubmission } from './review.ts'

/**
 * The verdict on the current head of the review, if this round has a verdict.
 *
 * Only the current head counts, on purpose. After the agent moves the review,
 * an older approval does not describe what is on the screen.
 */
export const currentSubmission = (review: Review): ReviewSubmission | null => {
  for (let index = review.submissions.length - 1; index >= 0; index -= 1) {
    const submission = review.submissions[index] as ReviewSubmission
    if (submission.head_sha === review.head_sha) return submission
  }
  return null
}

/** The latest verdict, on any head. */
export const latestSubmission = (review: Review): ReviewSubmission | null =>
  review.submissions[review.submissions.length - 1] ?? null

/**
 * Tells if the agent under review did something after the last verdict of an AI
 * reviewer. It can move the review to new work, or write in it. Both give the
 * turn to the reviewer. A reply alone can mean that the author disagrees, and
 * that also needs an answer.
 */
export const authorHasAnswered = (review: Review): boolean => {
  const verdict = latestSubmission(review)
  if (verdict === null || submissionAuthor(verdict) !== 'reviewer') return false
  if (review.head_sha !== verdict.head_sha) return true
  const spoken = [
    ...review.threads.flatMap((thread) => thread.comments),
    ...verdict.comments,
  ].filter((comment) => comment.author === 'agent')
  return spoken.some((comment) => comment.created_at > verdict.created_at)
}

/**
 * Tells if the agent answered a thread after the person last wrote in it.
 *
 * A resolved thread counts. An agent that marks a thread as done has said all
 * that it has to say. In other cases, the last author decides. When the person
 * replies to the answer of the agent, the thread goes back to the agent. A count
 * that ignored this would show the same work as done two times.
 */
export const threadIsAnswered = (thread: Thread): boolean => {
  if (thread.status === 'resolved') return true
  const last = thread.comments[thread.comments.length - 1]
  return last !== undefined && last.author === 'agent'
}

/**
 * How far the agent is with a review that has a verdict.
 *
 * - `idle`: nothing happened after the verdict.
 * - `in_progress`: answers or changes came, but some threads still wait.
 * - `ready`: no thread waits on the agent. Look at the review again.
 */
export type ProgressState = 'idle' | 'in_progress' | 'ready'

export interface ReviewProgress {
  state: ProgressState
  answered_threads: number
  awaiting_threads: number
  /** Tells if the head moved after the verdict. */
  code_changed: boolean
  /** Tells if the agent wrote a reply to the verdict itself. */
  summary_answered: boolean
}

/**
 * What happened to a review after its verdict. Returns null if it has no
 * verdict.
 *
 * The important difference is between *some* work and *all* work. Some work
 * tells that the agent started on the review. All work tells that it is time to
 * open the review again. A less specific signal needs a check by hand, and the
 * signal must prevent that work.
 *
 * `ready` does not need a change in the code, on purpose. An agent can answer
 * each comment and explain why it disagrees. That agent is also done, as is an
 * agent that changed the file. Both need a person to look.
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
