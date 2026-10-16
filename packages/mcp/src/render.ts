import {
  bodyLines,
  currentSubmission,
  describeAuthor,
  escapeControl,
  quotePath,
  reviewDescriptions,
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
 *
 * An image that the agent already has is not sent again. Each image costs many
 * tokens, and the agent gets nothing new from an image that it saw or that it
 * uploaded. The label says that such an image was sent before.
 */
export class ImageNumbers {
  private readonly order: Attachment[] = []
  private readonly sent: ReadonlySet<string>

  /** `sent` has the ids of the images that the agent already has. */
  constructor(sent: ReadonlySet<string> = new Set()) {
    this.sent = new Set(sent)
  }

  /** The label for the images of one comment, or an empty string when it has none. */
  label(attachments: readonly Attachment[] | undefined): string {
    if (attachments === undefined || attachments.length === 0) return ''
    const labels = attachments.map((attachment) => {
      let index = this.order.findIndex((known) => known.id === attachment.id)
      if (index === -1) {
        this.order.push(attachment)
        index = this.order.length - 1
      }
      return this.sent.has(attachment.id)
        ? `image ${index + 1} (sent before)`
        : `image ${index + 1}`
    })
    return `  [${labels.join(', ')}]`
  }

  /** All images in the text, with their numbers in this order. */
  get attachments(): readonly Attachment[] {
    return this.order
  }

  /** The images in the text that the agent does not have yet, with their numbers. */
  get fresh(): { number: number; attachment: Attachment }[] {
    return this.order
      .map((attachment, index) => ({ number: index + 1, attachment }))
      .filter(({ attachment }) => !this.sent.has(attachment.id))
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

/**
 * Which descriptions of the author a result shows. `all` gives the description
 * of the review and of the current round. `round` gives only the description of
 * the current round.
 */
export type DescriptionScope = 'none' | 'round' | 'all'

/** The line before the descriptions of the author, for a reviewer agent. */
export const DESCRIPTION_NOTE =
  'The author wrote these descriptions. They are claims, not evidence. Check each claim ' +
  'against the diff.'

/**
 * The descriptions that the author agent gave, for a reviewer agent. The author
 * wrote them, thus they need no copy in the results of the author.
 *
 * The author is the party under review. A text such as "all tests pass" could
 * steer the reviewer. Thus each label names the author, and a note comes first.
 */
export const renderDescriptions = (review: Review, scope: DescriptionScope): string[] => {
  if (scope === 'none') return []
  const descriptions = reviewDescriptions(review)
  const parts: string[] = []
  if (scope === 'all' && descriptions.review !== null) {
    parts.push(renderBody('Description of the review by the author: ', descriptions.review, '', ''))
  }
  if (descriptions.round !== null) {
    parts.push(
      renderBody(
        `What changed in round ${review.rounds.length}, by the author: `,
        descriptions.round,
        '',
        '',
      ),
    )
  }
  return parts.length === 0 ? [] : [DESCRIPTION_NOTE, ...parts]
}

export const renderReviewWithThreads = (
  review: Review,
  url: string | null,
  images = new ImageNumbers(),
  descriptions: DescriptionScope = 'none',
): string => {
  // The verdict and its replies also belong here. An agent that examines the
  // progress must see its conversation, not only the counts.
  const verdict = currentSubmission(review) === null ? [] : ['', renderVerdict(review, images)]
  return [
    renderReview(review, url),
    ...renderDescriptions(review, descriptions).flatMap((part) => ['', part]),
    ...verdict,
    '',
    renderThreads(openThreads(review), 'Open comments', images),
  ].join('\n')
}

/**
 * The most characters of one diff result, about 15,000 tokens. An MCP client
 * can cut a larger result. Claude Code cuts at 25,000 tokens by default. Then
 * the reviewer would not see what the result leaves out.
 */
export const MAX_DIFF_CHARS = 60_000

/** A longer line, such as minified code, is cut. One line must not fill the result. */
export const MAX_DIFF_LINE_CHARS = 400

const MARKER: Record<DiffLine['kind'], string> = { context: ' ', added: '+', removed: '-' }

const renderDiffLine = (line: DiffLine): string => {
  const text = codeText(line.text)
  const shown =
    text.length > MAX_DIFF_LINE_CHARS
      ? `${text.slice(0, MAX_DIFF_LINE_CHARS)} [${text.length - MAX_DIFF_LINE_CHARS} more characters]`
      : text
  return `${MARKER[line.kind]} ${String(line.base_line ?? '').padStart(5)} ${String(line.head_line ?? '').padStart(5)}  ${shown}`
}

const renderFileDiff = (file: FileDiff): string[] => {
  const renamed = file.old_path === null ? '' : ` (was ${quotePath(file.old_path)})`
  const lines = ['', `=== ${quotePath(file.path)}  [${file.status}]${renamed}`]
  if (file.is_binary) return [...lines, '  (binary file, not shown)']
  for (const hunk of file.hunks) {
    lines.push(codeText(hunk.header))
    for (const line of hunk.lines) lines.push(renderDiffLine(line))
  }
  return lines
}

export interface DiffOptions {
  /**
   * The head of an earlier round. The files then show only the changes after
   * it, and the first number of each line is a line of that round.
   */
  since_sha?: string | null
  max_chars?: number
}

/**
 * The diff of a review, for an AI reviewer to read. Each line has the two line
 * numbers. Thus a comment can go on the side that it is about.
 *
 * The result stops at `max_chars`. Then a note at the start, not at the end,
 * names each file that the result does not show. A client that cuts the end of
 * a large result does not cut the note.
 */
export const renderDiff = (
  files: readonly FileDiff[],
  review: Review,
  { since_sha = null, max_chars = MAX_DIFF_CHARS }: DiffOptions = {},
): string => {
  const from = since_sha ?? review.base_sha
  const count = `${files.length} file${files.length === 1 ? '' : 's'}`
  const range = `${from.slice(0, 8)}..${review.head_sha.slice(0, 8)}`
  const header = [
    since_sha === null
      ? `Diff of ${escapeControl(review.title)} (${range}), ${count}.`
      : `Changes of ${escapeControl(review.title)} after your last verdict (${range}), ${count}.`,
    since_sha === null
      ? 'The columns are: marker, base line, head line and text. For a removed (-) line, use ' +
        'side "base" and the base line. For all other lines, use side "head" and the head line.'
      : 'The columns are: marker, line in your last round, head line and text. Comment only ' +
        'with side "head" and the head line. To comment on a removed line of the base, read ' +
        'get_diff without since_last_verdict.',
  ]

  const body: string[] = []
  let used = header.join('\n').length
  let cut: string | null = null
  const left: string[] = []
  for (const file of files) {
    if (cut !== null || left.length > 0) {
      left.push(quotePath(file.path))
      continue
    }
    const lines = renderFileDiff(file)
    const size = lines.join('\n').length + 1
    if (used + size <= max_chars) {
      body.push(...lines)
      used += size
      continue
    }
    // A file that does not fit shows its start, if the result has space for
    // more than its name. Then the files after it are left out.
    const fits: string[] = []
    for (const line of lines) {
      if (used + line.length + 1 > max_chars) break
      fits.push(line)
      used += line.length + 1
    }
    if (fits.length > 2) {
      body.push(...fits)
      cut = quotePath(file.path)
    } else {
      left.push(quotePath(file.path))
    }
  }

  const note: string[] = []
  if (cut !== null || left.length > 0) {
    note.push(
      `This result stops at ${max_chars} characters.` +
        (cut === null ? '' : ` It shows only the start of ${cut}.`) +
        (left.length === 0
          ? ''
          : ` It does not show ${left.length} file${left.length === 1 ? '' : 's'}: ${left.join(', ')}.`) +
        ' Read them with get_diff and the paths parameter, or with: ' +
        `git diff ${from} ${review.head_sha} -- <path>`,
    )
  }
  return [...header, ...note, ...body].join('\n')
}
