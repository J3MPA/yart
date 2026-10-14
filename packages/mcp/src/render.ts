import { currentSubmission, describeAuthor, submissionAuthor } from '@yart/core'
import type { DiffLine, FileDiff, ReviewVerdict, Thread } from '@yart/core'
import type { Review } from '@yart/daemon'

/**
 * Threads come back as text, not as JSON.
 *
 * A model reads them and decides what to change. A comment next to its code is
 * much easier to act on than a line number in a JSON object. The text includes
 * the thread ids, because a reply and a resolve need them.
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
    return `${thread.origin.path}  [OUTDATED: the line of this comment does not exist now]`
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
 * The verdict, its summary, and the replies to it.
 *
 * The text shows the id, because the summary can get a reply. `reply_to_verdict`
 * needs the id when the review had more than one round.
 */
export const renderVerdict = (review: Review): string => {
  const submission = currentSubmission(review)
  if (submission === null) return 'No verdict yet.'

  const summary = submission.body === null ? '' : `\n\n  ${submission.body}`
  const replies = submission.comments.map(
    (comment) => `  ${describeAuthor(comment.author, comment.author_name)}: ${comment.body}`,
  )
  const conversation = replies.length === 0 ? '' : `\n\n${replies.join('\n')}`
  // Say clearly when an AI reviewer gave the verdict. The agent must know that the
  // person did not see its work yet.
  const by =
    submissionAuthor(submission) === 'reviewer'
      ? ` by ${describeAuthor('reviewer', submission.author_name)}`
      : ''

  return `Verdict: ${VERDICT_LABEL[submission.verdict]}${by}  [${submission.id}]${summary}${conversation}`
}

export const openThreads = (review: Review): Thread[] =>
  review.threads.filter((thread) => thread.status === 'open')

export const renderReview = (review: Review, url: string | null): string => {
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
    ...(url === null ? [] : [`  url:     ${url}`]),
    `  threads: ${review.threads.length} total, ${open.length} open${outdated > 0 ? `, ${outdated} outdated` : ''}`,
    '',
    `Files (${review.files.length}):`,
    files.length === 0 ? '  none' : indent(files, ''),
  ].join('\n')
}

/**
 * One line for each review, with its title first.
 *
 * A revision range does not identify a review in a list. `..HEAD` is not
 * correct after the head moves, and a hash says nothing.
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

export const renderReviewWithThreads = (review: Review, url: string | null): string => {
  // The verdict and its replies also belong here. An agent that examines the
  // progress must see its conversation, not only the counts.
  const verdict = currentSubmission(review) === null ? [] : ['', renderVerdict(review)]
  return [
    renderReview(review, url),
    ...verdict,
    '',
    renderThreads(openThreads(review), 'Open comments'),
  ].join('\n')
}

/**
 * After this count of lines, the diff stops. A reviewer reads it into its
 * context. For a change this large, it is better to read each file with git.
 */
export const MAX_DIFF_LINES = 3000

const MARKER: Record<DiffLine['kind'], string> = { context: ' ', added: '+', removed: '-' }

const renderDiffLine = (line: DiffLine): string =>
  `${MARKER[line.kind]} ${String(line.base_line ?? '').padStart(5)} ${String(line.head_line ?? '').padStart(5)}  ${line.text}`

/**
 * The diff of a review, for an AI reviewer to read. Each line has the two line
 * numbers. Thus a comment can go on the side that it is about.
 */
export const renderDiff = (files: readonly FileDiff[], review: Review): string => {
  const out: string[] = [
    `Diff of ${review.title} (${review.base_sha.slice(0, 8)}..${review.head_sha.slice(0, 8)}), ` +
      `${files.length} file${files.length === 1 ? '' : 's'}.`,
    'The columns are: marker, base line, head line and text. For a removed (-) line, use ' +
      'side "base" and the base line. For all other lines, use side "head" and the head line.',
  ]
  let written = 0
  for (const [index, file] of files.entries()) {
    if (written >= MAX_DIFF_LINES) {
      const left = files.slice(index).map((rest) => rest.path)
      out.push(
        '',
        `The diff stops at ${MAX_DIFF_LINES} lines. These files are not shown: ${left.join(', ')}. ` +
          `Read them with: git diff ${review.base_sha} ${review.head_sha} -- <path>`,
      )
      break
    }
    const renamed = file.old_path === null ? '' : ` (was ${file.old_path})`
    out.push('', `=== ${file.path}  [${file.status}]${renamed}`)
    if (file.is_binary) {
      out.push('  (binary file, not shown)')
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
