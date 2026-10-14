import { currentSubmission, describeAuthor, submissionAuthor } from '@yart/core'
import type { DiffLine, FileDiff, ReviewVerdict, Thread } from '@yart/core'
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
  const comments = thread.comments.map(
    (comment) => `  ${describeAuthor(comment.author, comment.author_name)}: ${comment.body}`,
  )
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
  const replies = submission.comments.map(
    (comment) => `  ${describeAuthor(comment.author, comment.author_name)}: ${comment.body}`,
  )
  const conversation = replies.length === 0 ? '' : `\n\n${replies.join('\n')}`
  // Said outright when an AI reviewer passed it, since the agent should know
  // its work has not yet been seen by the person.
  const by =
    submissionAuthor(submission) === 'reviewer'
      ? ` by ${describeAuthor('reviewer', submission.author_name)}`
      : ''

  return `Verdict: ${VERDICT_LABEL[submission.verdict]}${by}  [${submission.id}]${summary}${conversation}`
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

/**
 * Past this many lines a diff is cut short. A reviewer reads it into its
 * context, and a change this large is better read file by file with git.
 */
export const MAX_DIFF_LINES = 3000

const MARKER: Record<DiffLine['kind'], string> = { context: ' ', added: '+', removed: '-' }

const renderDiffLine = (line: DiffLine): string =>
  `${MARKER[line.kind]} ${String(line.base_line ?? '').padStart(5)} ${String(line.head_line ?? '').padStart(5)}  ${line.text}`

/**
 * A review's diff for an AI reviewer to read, with both line numbers on every
 * line so that a comment can be aimed at the side it is about.
 */
export const renderDiff = (files: readonly FileDiff[], review: Review): string => {
  const out: string[] = [
    `Diff of ${review.title} (${review.base_sha.slice(0, 8)}..${review.head_sha.slice(0, 8)}), ` +
      `${files.length} file${files.length === 1 ? '' : 's'}.`,
    'Columns: marker, base line, head line, text. Comment on a removed (-) line with side ' +
      '"base" and its base line, and on any other line with side "head" and its head line.',
  ]
  let written = 0
  for (const [index, file] of files.entries()) {
    if (written >= MAX_DIFF_LINES) {
      const left = files.slice(index).map((rest) => rest.path)
      out.push(
        '',
        `Cut short at ${MAX_DIFF_LINES} lines. Not shown: ${left.join(', ')}. ` +
          `Read them with: git diff ${review.base_sha} ${review.head_sha} -- <path>`,
      )
      break
    }
    const renamed = file.old_path === null ? '' : ` (was ${file.old_path})`
    out.push('', `=== ${file.path}  [${file.status}]${renamed}`)
    if (file.is_binary) {
      out.push('  (binary, not shown)')
      continue
    }
    for (const hunk of file.hunks) {
      out.push(hunk.header)
      for (const line of hunk.lines) {
        out.push(renderDiffLine(line))
        written += 1
      }
    }
  }
  return out.join('\n')
}
