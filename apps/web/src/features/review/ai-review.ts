import {
  authorHasAnswered,
  latestSubmission,
  reviewerRounds,
  submissionAuthor,
  type Review,
  type ReviewVerdict,
} from '@yart/core'

/**
 * Who does the next step in the AI phase.
 *
 * - `agent`: the agent answers the last verdict of the AI reviewer.
 * - `reviewer`: the agent answered, and the AI reviewer looks again.
 * - `person`: the AI reviewer approved, or it has no rounds left.
 */
export type AiNext = 'agent' | 'reviewer' | 'person'

export interface AiPhase {
  verdict: ReviewVerdict
  /** The name of the AI reviewer that gave the last verdict, or null. */
  author_name: string | null
  /** The verdicts that AI reviewers gave on the review, which is also the round of the last one. */
  rounds_used: number
  /** The verdicts that AI reviewers can give on a review, from the settings. */
  round_limit: number
  next: AiNext
}

/**
 * The AI phase of a review. Returns null when the latest verdict is not from an
 * AI reviewer.
 *
 * Only the latest verdict counts. A verdict of the person after an AI verdict
 * ends the AI phase.
 */
export const aiPhase = (review: Review, round_limit: number): AiPhase | null => {
  const submission = latestSubmission(review)
  if (submission === null || submissionAuthor(submission) !== 'reviewer') return null
  const rounds_used = reviewerRounds(review)
  const next: AiNext =
    submission.verdict === 'approved' || rounds_used >= round_limit
      ? 'person'
      : authorHasAnswered(review)
        ? 'reviewer'
        : 'agent'
  return {
    verdict: submission.verdict,
    author_name: submission.author_name ?? null,
    rounds_used,
    round_limit,
    next,
  }
}

/**
 * Tells if the person gave a verdict on the current head.
 *
 * A verdict of an AI reviewer does not count. The person did not submit it.
 */
export const personSubmittedOnHead = (review: Review): boolean =>
  review.submissions.some(
    (submission) =>
      submission.head_sha === review.head_sha && submissionAuthor(submission) === 'human',
  )
