import type { Review, ReviewSubmission } from '@yart/core'

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
