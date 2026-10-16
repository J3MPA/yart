import { describeAuthor, latestSubmission, reviewProgress } from '@yart/core'
import type { Review, ReviewSubmission, ReviewVerdict } from '@yart/core'
import { aiPhase, type AiPhase } from './ai-review'

/** Sufficient characters of a hash to identify it, which is all that a list needs. */
export const shortSha = (sha: string): string => sha.slice(0, 8)

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago, in words.
 *
 * People look quickly at a list of reviews. They do not read it. "3 minutes ago"
 * answers "is this the review that I just opened?" much faster than a time.
 */
export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown'

  const elapsed = now - then
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(elapsed / DAY)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * How the range of a review shows in a list.
 *
 * The head of a snapshot is a tree hash, which means nothing to a person. Thus
 * the text says what it is.
 */
export const describeRange = (review: {
  base_sha: string
  head_sha: string
  head_is_snapshot: boolean
}): string =>
  `${shortSha(review.base_sha)}..${review.head_is_snapshot ? 'working tree' : shortSha(review.head_sha)}`

/**
 * A repository as a person names it: the last part of its path.
 *
 * The code divides the path itself, because this runs in the browser. There,
 * `node:path` does not exist, and Vite replaces it with an empty stub. The code
 * removes empty parts. Thus a slash at the end does not make the name empty.
 */
export const repositoryName = (repo_path: string): string =>
  repo_path.split(/[\\/]/).filter(Boolean).pop() ?? repo_path

export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
}

/**
 * The round of a verdict that the agent moved the review after, or null for a
 * verdict on the current head. The round is 0 when the head of the verdict is
 * not a round of the review.
 */
export const earlierRound = (review: Review, submission: ReviewSubmission): number | null =>
  submission.head_sha === review.head_sha ? null : review.rounds.indexOf(submission.head_sha) + 1

/**
 * The label of the banner for a verdict of the person. A verdict on an earlier
 * round does not describe the code on the screen. Thus the label names that
 * round, and does not show the verdict alone.
 */
export const personVerdictLabel = (review: Review, submission: ReviewSubmission): string => {
  const verdict = VERDICT_LABEL[submission.verdict]
  const round = earlierRound(review, submission)
  if (round === null) return verdict
  return `Your verdict on ${round > 0 ? `round ${round}` : 'an earlier round'} · ${verdict}`
}

export type StatusTone = 'plain' | 'approved' | 'changes' | 'working' | 'ready' | 'ai'

export interface ReviewStatus {
  label: string
  tone: StatusTone
  /** The detail of the label, for a tooltip, or null when the label tells all. */
  detail: string | null
}

const answeredDetail = (review: Review): string | null => {
  const progress = reviewProgress(review)
  if (progress === null) return null
  const total = progress.answered_threads + progress.awaiting_threads
  return total === 0 ? null : `${progress.answered_threads} of ${total} comments answered`
}

const describeAiStatus = (phase: AiPhase, review: Review): ReviewStatus => {
  if (phase.next === 'person') {
    return {
      label: 'your turn',
      tone: 'ready',
      detail:
        phase.verdict === 'approved'
          ? 'The AI reviewer approved.'
          : `The AI reviewer used all ${phase.round_limit} rounds.`,
    }
  }
  if (phase.next === 'reviewer') {
    return {
      label: `AI review · round ${phase.rounds_used + 1} of ${phase.round_limit}`,
      tone: 'ai',
      detail: 'The agent answered. The AI reviewer looks at the review again.',
    }
  }
  const answered = answeredDetail(review)
  return {
    label: `AI review · round ${phase.rounds_used} of ${phase.round_limit}`,
    tone: 'ai',
    detail: `The agent answers the AI reviewer.${answered === null ? '' : ` ${answered}.`}`,
  }
}

/**
 * The state of a review, as one label.
 *
 * Before, the verdict and the progress of the agent were two badges. But they
 * are one fact at different times. You give a verdict, and then the agent
 * responds. After the agent moves, whose turn it is is more important than
 * what you decided. The verdict is at the top of the page that you open.
 *
 * The label uses the latest verdict, not the verdict of the current head. The
 * label must change when the agent moves the review, and at that time the
 * current head has no verdict.
 *
 * A verdict of an AI reviewer starts the AI phase, which has its own label.
 * The label says "your turn" only when the AI reviewer approved or has no
 * rounds left. Before that, the review is not ready for the person.
 */
export const describeStatus = (review: Review, round_limit: number): ReviewStatus => {
  const progress = reviewProgress(review)
  const submission = latestSubmission(review)

  if (progress === null || submission === null) {
    return { label: 'open', tone: 'plain', detail: null }
  }

  const phase = aiPhase(review, round_limit)
  if (phase !== null) return describeAiStatus(phase, review)

  const answered = answeredDetail(review)

  if (progress.state === 'ready') return { label: 'your turn', tone: 'ready', detail: answered }
  if (progress.state === 'in_progress') {
    return { label: 'agent working', tone: 'working', detail: answered }
  }

  const tone: StatusTone =
    submission.verdict === 'approved'
      ? 'approved'
      : submission.verdict === 'changes_requested'
        ? 'changes'
        : 'plain'
  return { label: VERDICT_LABEL[submission.verdict], tone, detail: null }
}

/**
 * Tells if the review waits on the person.
 *
 * A review with no verdict does not count. The agent that starts a review
 * opens it for the person, thus a signal is not necessary.
 */
export const isPersonsTurn = (review: Review, round_limit: number): boolean =>
  describeStatus(review, round_limit).tone === 'ready'

const AI_VERDICT_TEXT: Record<ReviewVerdict, string> = {
  approved: 'approved',
  changes_requested: 'requested changes',
  commented: 'commented',
}

/** What an AI verdict means for the person, as one or two sentences. */
export const describeAiVerdict = (phase: AiPhase): string => {
  const who = `AI ${describeAuthor('reviewer', phase.author_name)}`
  if (phase.verdict === 'approved') return `${who} approved. Your review is next.`
  const did = `${who} ${AI_VERDICT_TEXT[phase.verdict]}`
  if (phase.next === 'person') {
    return `${did} in its last round (${phase.rounds_used} of ${phase.round_limit}). Your review is next.`
  }
  const then =
    phase.next === 'reviewer'
      ? 'The agent answered, and the AI reviewer looks again.'
      : 'The agent answers, and then the AI reviewer looks again.'
  return `${did} in round ${phase.rounds_used} of ${phase.round_limit}. ${then}`
}
