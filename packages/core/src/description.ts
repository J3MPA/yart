import type { Review } from './review.ts'

/**
 * The most characters of one description. A description tells what changed,
 * what the agent tested, and where the risk is. It is not a second diff. Each
 * reviewer agent that reads the review also pays for it in tokens.
 */
export const MAX_DESCRIPTION_LENGTH = 10_000

export interface ReviewDescriptions {
  /** The description of the first round. It tells what the review is about. */
  review: string | null
  /**
   * The description of the current round, when the review has more than one
   * round. It tells what changed in this round.
   */
  round: string | null
}

/** The two descriptions that a reader of the review needs. */
export const reviewDescriptions = (review: Review): ReviewDescriptions => {
  const descriptions = review.round_descriptions ?? []
  const last = review.rounds.length - 1
  return {
    review: descriptions[0] ?? null,
    round: last > 0 ? (descriptions[last] ?? null) : null,
  }
}
