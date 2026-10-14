import type { Review } from './review.ts'
import type { CommentAuthor } from './types.ts'

/** Authors whose activity is news to the person: the agent and any AI reviewer. */
const isAi = (author: CommentAuthor): boolean => author !== 'human'

/**
 * How much the agent, and any AI reviewer, has said and done on a review, as a
 * single number.
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
      if (isAi(comment.author)) count += 1
    }
  }

  for (const submission of review.submissions) {
    // A reviewer's verdict is news; the person's own is not.
    if (submission.author === 'reviewer') count += 1
    for (const comment of submission.comments) {
      if (isAi(comment.author)) count += 1
    }
  }

  return count
}
