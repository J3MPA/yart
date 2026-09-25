import type { Review } from './review.ts'

/**
 * How much the agent has said and done on a review, as a single number.
 *
 * Used to tell "there is something here you have not seen" from "this is how
 * you left it". A timestamp would be the obvious thing to compare, but
 * `updated_at` moves when *anyone* touches the review — so writing a comment
 * would mark the review unread to the person who wrote it.
 *
 * Counted rather than hashed so that it only ever grows, which means a stale
 * marker can only under-report: the worst case is a missed dot, never a dot
 * that will not clear.
 */
export const agentActivity = (review: Review): number => {
  let count = review.rounds.length

  for (const thread of review.threads) {
    // A resolve is the agent saying "done" without saying anything, so it has
    // to count on its own or that turn would pass unnoticed.
    if (thread.status === 'resolved') count += 1
    for (const comment of thread.comments) {
      if (comment.author === 'agent') count += 1
    }
  }

  for (const submission of review.submissions) {
    for (const comment of submission.comments) {
      if (comment.author === 'agent') count += 1
    }
  }

  return count
}
