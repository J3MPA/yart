import type { Review, ReviewSubmission, SubmissionAuthor } from './review.ts'
import type { Comment } from './types.ts'

/** Who gave a verdict. A verdict from before reviewers existed belongs to the person. */
export const submissionAuthor = (submission: ReviewSubmission): SubmissionAuthor =>
  submission.author ?? 'human'

/**
 * How an author shows. The person and the agent show their role. An AI reviewer
 * shows its name, if it gave one. Thus you can tell two reviewers apart.
 */
export const describeAuthor = (
  author: Comment['author'] | SubmissionAuthor,
  author_name: string | null | undefined,
): string => {
  if (author !== 'reviewer') return author
  return author_name === null || author_name === undefined ? 'reviewer' : `reviewer ${author_name}`
}

/** How many verdicts AI reviewers gave on a review. */
export const reviewerRounds = (review: Review): number =>
  review.submissions.filter((submission) => submissionAuthor(submission) === 'reviewer').length
