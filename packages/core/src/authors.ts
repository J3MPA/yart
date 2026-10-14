import type { ReviewSubmission, SubmissionAuthor } from './review.ts'
import type { Comment } from './types.ts'

/** Who passed a verdict, reading one from before reviewers existed as the person's. */
export const submissionAuthor = (submission: ReviewSubmission): SubmissionAuthor =>
  submission.author ?? 'human'

/**
 * How an author is shown: the person and the agent by their role, an AI
 * reviewer by its name when it gave one, so that two reviewers read apart.
 */
export const describeAuthor = (
  author: Comment['author'] | SubmissionAuthor,
  author_name: string | null | undefined,
): string => {
  if (author !== 'reviewer') return author
  return author_name === null || author_name === undefined ? 'reviewer' : `reviewer ${author_name}`
}
