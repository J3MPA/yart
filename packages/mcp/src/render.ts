import type { Thread } from '@yart/core'
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

export const openThreads = (review: Review): Thread[] =>
  review.threads.filter((thread) => thread.status === 'open')

export const renderReview = (review: Review, url: string): string => {
  const files = review.files.map((file) => {
    const renamed = file.old_path === null ? '' : ` (was ${file.old_path})`
    return `  ${file.status.padEnd(9)} ${file.path}${renamed}`
  })

  const open = openThreads(review)
  const outdated = review.threads.filter((thread) => thread.anchor_state === 'outdated').length

  return [
    `Review ${review.id}`,
    `  range:   ${review.base}..${review.head}  (round ${review.rounds.length})`,
    `  status:  ${review.status}`,
    `  url:     ${url}`,
    `  threads: ${review.threads.length} total, ${open.length} open${outdated > 0 ? `, ${outdated} outdated` : ''}`,
    '',
    `Files (${review.files.length}):`,
    files.length === 0 ? '  none' : indent(files, ''),
  ].join('\n')
}

export const renderReviewWithThreads = (review: Review, url: string): string =>
  [renderReview(review, url), '', renderThreads(openThreads(review), 'Open comments')].join('\n')
