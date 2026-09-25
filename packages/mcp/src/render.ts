import { currentSubmission } from '@yart/core'
import type { ReviewVerdict, Thread } from '@yart/core'
import type { Review } from '@yart/daemon'

/**
 * Threads are rendered as text rather than returned as JSON.
 *
 * The consumer is a model deciding what to change, and a comment is far easier
 * to act on next to the code it points at than as a line number in a JSON
 * object. Thread ids are included because replying and resolving need them.
 */

const indent = (lines: readonly string[], prefix: string): string =>
  lines.map((line) => `${prefix}${line}`).join('\n')

const renderContext = (thread: Thread): string => {
  const { before, line, after } = thread.context
  const parts = [
    ...before.map((text) => `      ${text}`),
    `  >   ${line}`,
    ...after.map((text) => `      ${text}`),
  ]
  return parts.join('\n')
}

const renderLocation = (thread: Thread): string => {
  if (thread.anchor === null) {
    return `${thread.origin.path}  [OUTDATED — the commented line no longer exists]`
  }
  const moved =
    thread.anchor_state === 'shifted'
      ? `  (moved from ${thread.origin.path}:${thread.origin.line})`
      : ''
  return `${thread.anchor.path}:${thread.anchor.line}${moved}`
}

export const renderThread = (thread: Thread): string => {
  const comments = thread.comments.map((comment) => `  ${comment.author}: ${comment.body}`)
  const status = thread.status === 'resolved' ? ' [resolved]' : ''
  return [
    `[${thread.id}] ${renderLocation(thread)}${status}`,
    renderContext(thread),
    comments.join('\n'),
  ].join('\n')
}

export const renderThreads = (threads: readonly Thread[], heading: string): string => {
  if (threads.length === 0) return `${heading}: none.`
  return [`${heading} (${threads.length}):`, '', threads.map(renderThread).join('\n\n')].join('\n')
}

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'APPROVED',
  changes_requested: 'CHANGES REQUESTED',
  commented: 'COMMENTED',
}

export { currentSubmission } from '@yart/core'

/**
 * The verdict, its summary, and anything already said back to it.
 *
 * The id is shown because the summary can be replied to, and `reply_to_verdict`
 * needs something to aim at when the review has been round more than once.
 */
export const renderVerdict = (review: Review): string => {
  const submission = currentSubmission(review)
  if (submission === null) return 'Not submitted yet.'

  const summary = submission.body === null ? '' : `\n\n  ${submission.body}`
  const replies = submission.comments.map((comment) => `  ${comment.author}: ${comment.body}`)
  const conversation = replies.length === 0 ? '' : `\n\n${replies.join('\n')}`

  return `Verdict: ${VERDICT_LABEL[submission.verdict]}  [${submission.id}]${summary}${conversation}`
}

export const openThreads = (review: Review): Thread[] =>
  review.threads.filter((thread) => thread.status === 'open')

export const renderReview = (review: Review, url: string): string => {
  const files = review.files.map((file) => {
    const renamed = file.old_path === null ? '' : ` (was ${file.old_path})`
    return `  ${file.status.padEnd(9)} ${file.path}${renamed}`
  })

  const open = openThreads(review)
  const outdated = review.threads.filter((thread) => thread.anchor_state === 'outdated').length

  const submission = currentSubmission(review)

  return [
    `Review ${review.id}`,
    `  title:   ${review.title}`,
    `  range:   ${review.base}..${review.head}  (round ${review.rounds.length})`,
    `  status:  ${review.status}${submission === null ? '' : ` — ${VERDICT_LABEL[submission.verdict]}`}`,
    `  url:     ${url}`,
    `  threads: ${review.threads.length} total, ${open.length} open${outdated > 0 ? `, ${outdated} outdated` : ''}`,
    '',
    `Files (${review.files.length}):`,
    files.length === 0 ? '  none' : indent(files, ''),
  ].join('\n')
}

/**
 * One line per review, led by its title.
 *
 * A revision range does not identify anything in a list: `..HEAD` is stale the
 * moment the head moves, and a hash says nothing at all.
 */
export const renderReviewLine = (review: Review): string => {
  const submission = currentSubmission(review)
  const state = submission === null ? 'open' : VERDICT_LABEL[submission.verdict].toLowerCase()
  const open = openThreads(review).length
  return [
    `${review.title}`,
    `  ${review.id}`,
    `  ${state} · ${review.files.length} file(s) · ${open} open of ${review.threads.length}`,
  ].join('\n')
}

export const renderReviewWithThreads = (review: Review, url: string): string => {
  // The verdict and anything said back to it belong here too: an agent checking
  // progress needs to see the conversation it is part of, not just the counts.
  const verdict = currentSubmission(review) === null ? [] : ['', renderVerdict(review)]
  return [
    renderReview(review, url),
    ...verdict,
    '',
    renderThreads(openThreads(review), 'Open comments'),
  ].join('\n')
}
