import {
  submissionAuthor,
  type Comment,
  type CommentAuthor,
  type Review,
  type ReviewSubmission,
} from '@yart/core'

/** One comment in the history, with the place in the code that it is about. */
export interface HistoryEntry {
  comment: Comment
  /** The file of the thread, or null for a reply to a verdict. */
  path: string | null
  /** `path:line`, or null for a reply to a verdict. */
  location: string | null
}

/**
 * One step of the history: a verdict with the comments that belong to it, or
 * the comments before the first verdict or after the last.
 */
export interface HistoryBlock {
  kind: 'before' | 'verdict' | 'since'
  submission: ReviewSubmission | null
  /** The round of the verdict, from 1, or null when the head is not a known round. */
  round: number | null
  entries: HistoryEntry[]
}

/** Tells if an AI reviewer gave a verdict on the review. */
export const hasAiReview = (review: Review): boolean =>
  review.submissions.some((submission) => submissionAuthor(submission) === 'reviewer')

/**
 * Tells if the history opens when the page opens. It opens when an AI reviewer
 * took part, and when the agent wrote after the last verdict. Then the history
 * has an exchange that the person did not read yet.
 */
export const historyOpens = (review: Review): boolean => {
  if (hasAiReview(review)) return true
  const last = review.submissions[review.submissions.length - 1]
  if (last === undefined) return false
  return [...review.threads.flatMap((thread) => thread.comments), ...last.comments].some(
    (comment) => comment.author === 'agent' && comment.created_at > last.created_at,
  )
}

const sameParty = (author: CommentAuthor, submission: ReviewSubmission): boolean =>
  author === submissionAuthor(submission)

/**
 * Puts the comments of a review into steps, one for each verdict.
 *
 * A comment of the person or of a reviewer belongs to the first verdict of the
 * same author at or after it. Comments that are held for a verdict get the time
 * of the submit, thus they belong to that verdict. A reply of the agent belongs
 * to the last verdict before it, because it answers that verdict. A comment
 * with no such verdict goes to a step before the first verdict or after the
 * last. A reply to a verdict belongs to that verdict.
 */
export const buildHistory = (review: Review): HistoryBlock[] => {
  const verdicts = review.submissions.map((submission): HistoryBlock => ({
    kind: 'verdict',
    submission,
    round: review.rounds.includes(submission.head_sha)
      ? review.rounds.indexOf(submission.head_sha) + 1
      : null,
    entries: submission.comments.map((comment) => ({ comment, path: null, location: null })),
  }))
  const before: HistoryBlock = { kind: 'before', submission: null, round: null, entries: [] }
  const since: HistoryBlock = { kind: 'since', submission: null, round: null, entries: [] }

  for (const thread of review.threads) {
    const anchor = thread.anchor ?? thread.origin
    for (const comment of thread.comments) {
      const entry: HistoryEntry = {
        comment,
        path: anchor.path,
        location: `${anchor.path}:${anchor.line}`,
      }
      if (comment.author === 'agent') {
        const answered = [...verdicts]
          .reverse()
          .find((block) => (block.submission as ReviewSubmission).created_at <= comment.created_at)
        ;(answered ?? before).entries.push(entry)
      } else {
        const part_of = verdicts.find(
          (block) =>
            (block.submission as ReviewSubmission).created_at >= comment.created_at &&
            sameParty(comment.author, block.submission as ReviewSubmission),
        )
        ;(part_of ?? since).entries.push(entry)
      }
    }
  }

  const byTime = (a: HistoryEntry, b: HistoryEntry) =>
    a.comment.created_at.localeCompare(b.comment.created_at)
  return [before, ...verdicts, since]
    .map((block) => ({ ...block, entries: [...block.entries].sort(byTime) }))
    .filter((block) => block.kind === 'verdict' || block.entries.length > 0)
}

/**
 * Tells if the page shows the history. With one verdict and no line comments,
 * the history would only repeat the verdict banner above it.
 */
export const showsHistory = (review: Review): boolean => {
  const blocks = buildHistory(review)
  return (
    blocks.length > 1 || blocks.some((block) => block.entries.some((entry) => entry.path !== null))
  )
}
