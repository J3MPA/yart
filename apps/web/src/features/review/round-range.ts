import { submissionAuthor, type Review } from '@yart/core'

/** What the diff of the review page shows. */
export type DiffRange = 'all' | 'since'

/** The latest verdict of the person, on any round. */
const lastVerdictOfPerson = (review: Review) =>
  [...review.submissions].reverse().find((submission) => submissionAuthor(submission) === 'human')

/**
 * The head that "Since round N" compares from, or null when the review has one
 * round only. It is the head of the last verdict of the person, when the agent
 * moved the review after it. Then the person sees all the work after their
 * review, also over more than one round. Else it is the head of the round before
 * this one.
 */
export const sinceHead = (review: Review): string | null => {
  if (review.rounds.length < 2) return null
  const verdict = lastVerdictOfPerson(review)
  if (
    verdict !== undefined &&
    verdict.head_sha !== review.head_sha &&
    review.rounds.includes(verdict.head_sha)
  ) {
    return verdict.head_sha
  }
  return review.rounds[review.rounds.length - 2] ?? null
}

/** The number of the round of a head. The first round is 1. */
export const roundOf = (review: Review, head_sha: string): number =>
  review.rounds.indexOf(head_sha) + 1

/**
 * The range that the page opens on. When the agent moved the review after the
 * verdict of the person, the person wants to see the new work first.
 */
export const defaultRange = (review: Review): DiffRange => {
  const verdict = lastVerdictOfPerson(review)
  return verdict !== undefined && sinceHead(review) === verdict.head_sha ? 'since' : 'all'
}

/**
 * Keeps only the anchors on the head side. In the "since" view, the base side
 * of a row is a line of an earlier round, not of the base of the review. Thus a
 * thread or a held comment on the base side would show on the wrong line.
 */
export const headSideOnly = <Value>(by_anchor: ReadonlyMap<string, Value>): Map<string, Value> =>
  new Map([...by_anchor].filter(([key]) => !key.startsWith('base\u0000')))
