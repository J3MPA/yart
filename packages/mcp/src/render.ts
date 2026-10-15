import {
  bodyLines,
  currentSubmission,
  describeAuthor,
  escapeControl,
  quotePath,
  submissionAuthor,
} from '@yart/core'
import type { Attachment, Comment, DiffLine, FileDiff, ReviewVerdict, Thread } from '@yart/core'
import type { Review } from '@yart/daemon'

/**
 * Threads come back as text, not as JSON.
 *
 * A model reads them and decides what to change. A comment next to its code is
 * much easier to act on than a line number in a JSON object. The text includes
 * the thread ids, because a reply and a resolve need them.
 *
 * Other parties write some of this text: an AI reviewer, the agent, and the
 * names of files in the repository. A line break in such text must not start a
 * line that looks like a line of yart, for example a comment of the person.
 * Thus a body with more than one line goes into a block where each line starts
 * with `|`. A name, a title and a path show each line break as an escape.
 */

/**
 * Numbers the images of one tool result, in the order that the text shows them.
 * The text gives each comment the numbers of its images, and the images follow
 * the text with the same numbers.
 */
export class ImageNumbers {
  private readonly order: Attachment[] = []

  /** The label for the images of one comment, or an empty string when it has none. */
  label(attachments: readonly Attachment[] | undefined): string {
    if (attachments === undefined || attachments.length === 0) return ''
    const numbers = attachments.map((attachment) => {
      const index = this.order.findIndex((known) => known.id === attachment.id)
      if (index !== -1) return index + 1
      this.order.push(attachment)
      return this.order.length
    })
    return `  [${numbers.map((number) => `image ${number}`).join(', ')}]`
  }

  get attachments(): readonly Attachment[] {
    return this.order
  }
}

const indent = (lines: readonly string[], prefix: string): string =>
  lines.map((line) => `${prefix}${line}`).join('\n')

/**
 * A line of code. git splits the code at each newline, but a model can also
 * read a different line break as the start of a line. The carriage return at
 * the end of a line of a CRLF file stays.
 */
const codeText = (text: string): string =>
  text.replace(/\r(?!$)|[\n\v\f\u0085\u2028\u2029]/g, escapeControl)

/**
 * A body of text after a label, such as `human: `. One line stays next to the
 * label. More lines go into a block, with `|` at the start of each line. Thus
 * no line of the body can look like a line of yart. With a label, the block
 * goes below it. Without a label, the block takes the place of the body.
 */
const renderBody = (label: string, body: string, suffix: string, prefix: string): string => {
  const lines = bodyLines(body)
  if (lines.length === 1) return `${prefix}${label}${lines[0]}${suffix}`
  const gutter = label === '' ? prefix : `${prefix}  `
  const block = lines.map((line) => `${gutter}| ${line}`.trimEnd())
  return label === ''
    ? `${block.join('\n')}${suffix}`
    : [`${prefix}${label.trimEnd()}${suffix}`, ...block].join('\n')
}

const renderComment = (comment: Comment, images: ImageNumbers): string =>
  renderBody(
    `${escapeControl(describeAuthor(comment.author, comment.author_name))}: `,
    comment.body,
    images.label(comment.attachments),
    '  ',
  )

const renderContext = (thread: Thread): string => {
  const { before, line, after } = thread.context
  const parts = [
    ...before.map((text) => `      ${codeText(text)}`),
    `  >   ${codeText(line)}`,
    ...after.map((text) => `      ${codeText(text)}`),
  ]
  return parts.join('\n')
}

const renderLocation = (thread: Thread): string => {
  if (thread.anchor === null) {
    return `${quotePath(thread.origin.path)}  [OUTDATED: the line of this comment does not exist now]`
  }
  const moved =
    thread.anchor_state === 'shifted'
      ? `  (moved from ${quotePath(thread.origin.path)}:${thread.origin.line})`
      : ''
  return `${quotePath(thread.anchor.path)}:${thread.anchor.line}${moved}`
}

export const renderThread = (thread: Thread, images = new ImageNumbers()): string => {
  const comments = thread.comments.map((comment) => renderComment(comment, images))
  const status = thread.status === 'resolved' ? ' [resolved]' : ''
  return [
    `[${thread.id}] ${renderLocation(thread)}${status}`,
    renderContext(thread),
    comments.join('\n'),
  ].join('\n')
}

export const renderThreads = (
  threads: readonly Thread[],
  heading: string,
  images = new ImageNumbers(),
): string => {
  if (threads.length === 0) return `${heading}: none.`
  return [
    `${heading} (${threads.length}):`,
    '',
    threads.map((thread) => renderThread(thread, images)).join('\n\n'),
  ].join('\n')
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
export const renderVerdict = (review: Review, images = new ImageNumbers()): string => {
  const submission = currentSubmission(review)
  if (submission === null) return 'No verdict yet.'

  const summary_images = images.label(submission.attachments)
  const summary =
    submission.body === null
      ? summary_images === ''
        ? ''
        : `\n\n${summary_images}`
      : `\n\n${renderBody('', submission.body, summary_images, '  ')}`
  const replies = submission.comments.map((comment) => renderComment(comment, images))
  const conversation = replies.length === 0 ? '' : `\n\n${replies.join('\n')}`
  // Say clearly when an AI reviewer gave the verdict. The agent must know that the
  // person did not see its work yet.
  const by =
    submissionAuthor(submission) === 'reviewer'
      ? ` by ${escapeControl(describeAuthor('reviewer', submission.author_name))}`
      : ''

  return `Verdict: ${VERDICT_LABEL[submission.verdict]}${by}  [${submission.id}]${summary}${conversation}`
}

export const openThreads = (review: Review): Thread[] =>
  review.threads.filter((thread) => thread.status === 'open')

export const renderReview = (review: Review, url: string | null): string => {
  const files = review.files.map((file) => {
    const renamed = file.old_path === null ? '' : ` (was ${quotePath(file.old_path)})`
    return `  ${file.status.padEnd(9)} ${quotePath(file.path)}${renamed}`
  })

  const open = openThreads(review)
  const outdated = review.threads.filter((thread) => thread.anchor_state === 'outdated').length

  const submission = currentSubmission(review)

  return [
    `Review ${review.id}`,
    `  title:   ${escapeControl(review.title)}`,
    `  range:   ${escapeControl(review.base)}..${escapeControl(review.head)}  (round ${review.rounds.length})`,
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
    escapeControl(review.title),
    `  ${review.id}`,
    `  ${state} · ${review.files.length} file(s) · ${open} open of ${review.threads.length}`,
  ].join('\n')
}

export const renderReviewWithThreads = (
  review: Review,
  url: string | null,
  images = new ImageNumbers(),
): string => {
  // The verdict and its replies also belong here. An agent that examines the
  // progress must see its conversation, not only the counts.
  const verdict = currentSubmission(review) === null ? [] : ['', renderVerdict(review, images)]
  return [
    renderReview(review, url),
    ...verdict,
    '',
    renderThreads(openThreads(review), 'Open comments', images),
  ].join('\n')
}

/**
 * After this count of lines, the diff stops. A reviewer reads it into its
 * context. For a change this large, it is better to read each file with git.
 */
export const MAX_DIFF_LINES = 3000

const MARKER: Record<DiffLine['kind'], string> = { context: ' ', added: '+', removed: '-' }

const renderDiffLine = (line: DiffLine): string =>
  `${MARKER[line.kind]} ${String(line.base_line ?? '').padStart(5)} ${String(line.head_line ?? '').padStart(5)}  ${codeText(line.text)}`

/**
 * The diff of a review, for an AI reviewer to read. Each line has the two line
 * numbers. Thus a comment can go on the side that it is about.
 */
export const renderDiff = (files: readonly FileDiff[], review: Review): string => {
  const out: string[] = [
    `Diff of ${escapeControl(review.title)} (${review.base_sha.slice(0, 8)}..${review.head_sha.slice(0, 8)}), ` +
      `${files.length} file${files.length === 1 ? '' : 's'}.`,
    'The columns are: marker, base line, head line and text. For a removed (-) line, use ' +
      'side "base" and the base line. For all other lines, use side "head" and the head line.',
  ]
  let written = 0
  for (const [index, file] of files.entries()) {
    if (written >= MAX_DIFF_LINES) {
      const left = files.slice(index).map((rest) => quotePath(rest.path))
      out.push(
        '',
        `The diff stops at ${MAX_DIFF_LINES} lines. These files are not shown: ${left.join(', ')}. ` +
          `Read them with: git diff ${review.base_sha} ${review.head_sha} -- <path>`,
      )
      break
    }
    const renamed = file.old_path === null ? '' : ` (was ${quotePath(file.old_path)})`
    out.push('', `=== ${quotePath(file.path)}  [${file.status}]${renamed}`)
    if (file.is_binary) {
      out.push('  (binary file, not shown)')
      continue
    }
    for (const hunk of file.hunks) {
      out.push(codeText(hunk.header))
      for (const line of hunk.lines) {
        out.push(renderDiffLine(line))
        written += 1
      }
    }
  }
  return out.join('\n')
}
