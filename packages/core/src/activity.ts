import type { Review } from './review.ts'
import type { CommentAuthor } from './types.ts'

/** The authors whose activity is new information for the person: the agent and each AI reviewer. */
const isAi = (author: CommentAuthor): boolean => author !== 'human'

/**
 * Gives one number for all that the agent and each AI reviewer said and did on
 * a review.
 *
 * The number tells "you did not see this" apart from "this is as you left it".
 * A time is not correct for this. `updated_at` changes when *anyone* touches the
 * review. Thus your own comment would mark the review as unread for you.
 *
 * A count, not a hash, only increases. Thus an old mark can only show too
 * little. The worst result is a missed dot. It is never a dot that does not go
 * away.
 */
export const agentActivity = (review: Review): number => {
  let count = review.rounds.length

  for (const thread of review.threads) {
    // A resolved thread is the agent saying "done" with no words. Thus it counts
    // alone. If it did not count, nobody would see that turn.
    if (thread.status === 'resolved') count += 1
    for (const comment of thread.comments) {
      if (isAi(comment.author)) count += 1
    }
  }

  for (const submission of review.submissions) {
    // The verdict of a reviewer is new information. The verdict of the person
    // is not.
    if (submission.author === 'reviewer') count += 1
    for (const comment of submission.comments) {
      if (isAi(comment.author)) count += 1
    }
  }

  return count
}
