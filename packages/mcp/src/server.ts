import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { latestSubmission, reviewerRounds, submissionAuthor, type Settings } from '@yart/core'
import type { Review } from '@yart/daemon'
import { DaemonClient, DEFAULT_PORT, type DaemonClientOptions } from './daemon-client.ts'
import { browserOpeningEnabled, openReview } from './open-browser.ts'
import {
  openThreads,
  renderDiff,
  renderReview,
  renderReviewLine,
  renderReviewWithThreads,
  renderThreads,
  renderVerdict,
} from './render.ts'

const DEFAULT_WAIT_SECONDS = 300
const MAX_WAIT_SECONDS = 1800

/* eslint-disable @typescript-eslint/naming-convention -- MCP wire field names */
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/**
 * Builds a tool config, keeping the protocol's `inputSchema` spelling in one
 * place. Generic so `registerTool` still infers the handler's argument types
 * from the schema.
 */
const toolConfig = <Schema>(config: {
  title: string
  description: string
  input_schema: Schema
}) => ({
  title: config.title,
  description: config.description,
  inputSchema: config.input_schema,
})
/* eslint-enable @typescript-eslint/naming-convention */

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] })

/**
 * What the agent under review should know about a verdict an AI reviewer
 * passed: that the person has not seen the work yet, and when the reviewer has
 * no rounds left, that the next move is the person's rather than another fix.
 */
const reviewerNote = (review: Review, settings: Settings): string | null => {
  const verdict = latestSubmission(review)
  if (verdict === null || submissionAuthor(verdict) !== 'reviewer') return null
  if (verdict.verdict === 'approved') {
    return 'An AI reviewer approved this; the person has not looked yet. Tell them it is ready for their review.'
  }
  if (reviewerRounds(review) >= settings.ai_review_rounds) {
    return (
      'The AI reviewer has used its last round. Make no further changes for it: ' +
      'tell the person the review is theirs to finish, and what is still open.'
    )
  }
  return null
}

const describeSettings = (settings: Settings): string =>
  [
    'Reviewer settings:',
    `  model:        ${settings.reviewer_model ?? 'not set: use your own choice'}`,
    `  effort:       ${settings.reviewer_effort ?? 'not set'}`,
    `  rounds:       ${settings.ai_review_rounds} verdicts per review`,
    `  instructions: ${settings.reviewer_instructions ?? 'none'}`,
  ].join('\n')

const failure = (body: string): ToolResult => ({
  content: [{ type: 'text', text: body }],
  // eslint-disable-next-line @typescript-eslint/naming-convention -- MCP wire field
  isError: true,
})

/**
 * Every tool runs through this so a daemon or git failure reaches the model as
 * a readable message it can act on, rather than as a transport-level error that
 * ends the tool call with no explanation.
 */
const guard = async (run: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await run()
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : 'Unexpected error')
  }
}

export interface McpServerOptions extends DaemonClientOptions {
  /**
   * Shows a new review to the person who has to read it.
   *
   * Injectable so the tests can watch it being called without a window opening
   * on whoever is running them. Whether it is called at all is the
   * environment's business, not this option's.
   */
  openBrowser?: (url: string) => void
}

export const createMcpServer = (options: McpServerOptions = {}): McpServer => {
  const daemon = new DaemonClient(options)
  const server = new McpServer({ name: 'yart', version: '0.0.0' })

  const port = options.port ?? DEFAULT_PORT
  const openBrowser = options.openBrowser ?? ((url: string) => openReview(url, port))
  const opening_enabled = browserOpeningEnabled()

  server.registerTool(
    'start_review',
    toolConfig({
      title: 'Start a review',
      description:
        'Open a code review so a human can comment on your changes. Call this as ' +
        'soon as you have finished making changes — they do NOT need to be ' +
        'committed. By default this reviews the current uncommitted state of the ' +
        'working tree, including files you have just created. Returns a review id ' +
        'and a URL for the human to open. Follow it with await_review.',
      input_schema: {
        base: z
          .string()
          .optional()
          .describe(
            'Revision to compare from, such as a branch name, a commit sha, or HEAD~3. ' +
              'Defaults to HEAD, which is right when reviewing uncommitted work.',
          ),
        head: z
          .string()
          .optional()
          .describe(
            'What to compare to. Defaults to "working", meaning the current state of ' +
              'the files on disk, committed or not. Pass a revision instead to review ' +
              'work that is already committed.',
          ),
        title: z
          .string()
          .optional()
          .describe(
            'A short name for this review, shown in the list of them. ' +
              'Defaults to the head commit subject. Give one when several reviews ' +
              'are open at once and the commit subject would not tell them apart.',
          ),
      },
    }),
    async ({ base, head, title }) =>
      guard(async () => {
        const review = await daemon.createReview(base, head, title)
        const url = daemon.reviewUrl(review.id)

        if (review.files.length === 0) {
          return text(
            [
              renderReview(review, url),
              '',
              'Nothing differs between those two points, so there is nothing to review.',
              'If you meant to review committed work, pass a base such as HEAD~1 or main.',
            ].join('\n'),
          )
        }

        // An empty review is not worth a window, which is why this sits after
        // the check above rather than beside the call that created it.
        if (opening_enabled) openBrowser(url)

        return text(
          [
            renderReview(review, url),
            '',
            opening_enabled
              ? 'Opened it for them. Tell them it is up, then call await_review with this id.'
              : 'Ask the human to open that URL and review. Then call await_review with this id.',
          ].join('\n'),
        )
      }),
  )

  server.registerTool(
    'await_review',
    toolConfig({
      title: 'Wait for the review to be submitted',
      description:
        'Block until the human submits the review, then return their open comments. ' +
        'Returns what has been written so far if the wait times out, so a timeout is ' +
        'not a failure — call it again to keep waiting.',
      input_schema: {
        review_id: z.string().describe('The id returned by start_review.'),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(`How long to wait before returning. Defaults to ${DEFAULT_WAIT_SECONDS}.`),
      },
    }),
    async ({ review_id, timeout_seconds }) =>
      guard(async () => {
        const seconds = timeout_seconds ?? DEFAULT_WAIT_SECONDS
        const submitted = await daemon.waitForSubmission(review_id, seconds * 1000)

        if (submitted === null) {
          const pending = await daemon.getReview(review_id)
          return text(
            [
              `Not submitted yet after ${seconds}s. Call await_review again to keep waiting.`,
              '',
              renderThreads(openThreads(pending), 'Comments so far'),
            ].join('\n'),
          )
        }

        const open = openThreads(submitted)
        const note = reviewerNote(submitted, await daemon.getSettings())
        const verdict =
          note === null ? renderVerdict(submitted) : `${renderVerdict(submitted)}\n\n${note}`

        if (open.length === 0) {
          return text(
            [
              verdict,
              '',
              'No open comments.',
              'Use reply_to_verdict to answer the summary, so it lands in the review.',
            ].join('\n'),
          )
        }
        return text(
          [
            verdict,
            '',
            renderThreads(open, 'Open comments'),
            '',
            'Address these, commit, then call advance_review to re-anchor them onto your changes.',
            'Reply on a comment with reply_to_thread, or on the verdict itself with reply_to_verdict.',
          ].join('\n'),
        )
      }),
  )

  server.registerTool(
    'get_review',
    toolConfig({
      title: 'Read a review',
      description:
        'Read a review and its open comments without waiting. Use this to check ' +
        'progress; use await_review to block until the human is done.',
      input_schema: { review_id: z.string().describe('The id returned by start_review.') },
    }),
    async ({ review_id }) =>
      guard(async () => {
        const review = await daemon.getReview(review_id)
        return text(renderReviewWithThreads(review, daemon.reviewUrl(review.id)))
      }),
  )

  server.registerTool(
    'list_reviews',
    toolConfig({
      title: 'List reviews',
      description: 'List reviews for this repository, newest first.',
      input_schema: {},
    }),
    async () =>
      guard(async () => {
        const reviews = await daemon.listReviews()
        if (reviews.length === 0) return text('No reviews yet.')
        return text(reviews.map(renderReviewLine).join('\n'))
      }),
  )

  server.registerTool(
    'reply_to_thread',
    toolConfig({
      title: 'Reply to a comment',
      description:
        'Post a reply on a comment thread. Use this to explain what you changed, ' +
        'or to push back when you disagree with the comment.',
      input_schema: {
        review_id: z.string(),
        thread_id: z.string().describe('The id in brackets before each comment.'),
        body: z.string().describe('The reply text.'),
      },
    }),
    async ({ review_id, thread_id, body }) =>
      guard(async () => {
        await daemon.replyToThread(review_id, thread_id, body)
        return text(`Replied to ${thread_id}.`)
      }),
  )

  server.registerTool(
    'reply_to_verdict',
    toolConfig({
      title: 'Reply to the review verdict',
      description:
        'Answer the summary the human left when they submitted the review, as ' +
        'opposed to a comment on a line. Use this to say what you did about the ' +
        'verdict as a whole, to report work that was already finished, or to ' +
        'disagree with it \u2014 so the answer lands in the review rather than ' +
        'only in the chat.',
      input_schema: {
        review_id: z.string(),
        body: z.string().describe('The reply text.'),
        submission_id: z
          .string()
          .optional()
          .describe(
            'The id in brackets beside the verdict. Defaults to the most recent ' +
              'verdict, which is the one you were just given.',
          ),
      },
    }),
    async ({ review_id, body, submission_id }) =>
      guard(async () => {
        let target = submission_id
        if (target === undefined) {
          const review = await daemon.getReview(review_id)
          const submission = latestSubmission(review)
          if (submission === null) {
            return text('This review has not been submitted yet, so there is no verdict to answer.')
          }
          target = submission.id
        }
        await daemon.replyToVerdict(review_id, target, body)
        return text(`Replied to the verdict on ${review_id}.`)
      }),
  )

  server.registerTool(
    'resolve_thread',
    toolConfig({
      title: 'Resolve a comment',
      description:
        'Mark a comment thread as addressed. Reply first when the change is not ' +
        'self-evident, so the human can see what you did before it collapses.',
      input_schema: {
        review_id: z.string(),
        thread_id: z.string().describe('The id in brackets before each comment.'),
      },
    }),
    async ({ review_id, thread_id }) =>
      guard(async () => {
        await daemon.setThreadStatus(review_id, thread_id, 'resolved')
        return text(`Resolved ${thread_id}.`)
      }),
  )

  server.registerTool(
    'advance_review',
    toolConfig({
      title: 'Move the review onto your new commits',
      description:
        'Re-anchor every comment onto your latest changes. Call this after ' +
        'addressing the review, whether or not you committed: comments follow the ' +
        'lines they referred to, and any whose line you rewrote are marked ' +
        'outdated. Reopens the review so the human can look again.',
      input_schema: {
        review_id: z.string(),
        head: z
          .string()
          .optional()
          .describe(
            'What to compare to now. Defaults to the same kind of head the review ' +
              'already had, so a review of uncommitted work re-reads the files on disk.',
          ),
      },
    }),
    async ({ review_id, head }) =>
      guard(async () => {
        const review = await daemon.advanceReview(review_id, head)
        return text(
          [
            renderReviewWithThreads(review, daemon.reviewUrl(review.id)),
            '',
            'Ask the human to look again, then call await_review.',
          ].join('\n'),
        )
      }),
  )

  // The reviewing side. One MCP server serves both, so these say plainly that
  // they are for reviewing someone else's work: an agent asked to have its own
  // change reviewed must not pass a verdict on it.

  server.registerTool(
    'get_reviewer_settings',
    toolConfig({
      title: 'Read how an AI reviewer should run',
      description:
        'Read how the person wants an AI reviewer run: the model and effort to start it on, ' +
        'what it should look for, and how many verdicts it gets per review. Call this before ' +
        'starting a reviewer — a subagent or another session — for a review, start it on that ' +
        'model and effort where the tool starting it allows, and include the instructions in ' +
        'its brief.',
      input_schema: {},
    }),
    async () =>
      guard(async () =>
        text(
          [
            describeSettings(await daemon.getSettings()),
            '',
            'The reviewer works with get_diff, submit_verdict and await_author, and must not be ' +
              'the agent whose work is under review.',
          ].join('\n'),
        ),
      ),
  )

  server.registerTool(
    'get_diff',
    toolConfig({
      title: 'Read the changes under review',
      description:
        'For an AI reviewer of someone else’s work: read a review’s changes as a diff, with ' +
        'base and head line numbers on every line to aim comments at. Read it before each ' +
        'submit_verdict, since the author may have advanced the review since.',
      input_schema: { review_id: z.string().describe('The review to read.') },
    }),
    async ({ review_id }) =>
      guard(async () => {
        const [review, files] = await Promise.all([
          daemon.getReview(review_id),
          daemon.getDiff(review_id),
        ])
        return text(renderDiff(files, review))
      }),
  )

  server.registerTool(
    'submit_verdict',
    toolConfig({
      title: 'Pass a verdict as an AI reviewer',
      description:
        'For an AI reviewer only, never for reviewing your own work. Pass a verdict on a review ' +
        'with your line comments and replies to existing comments, all in one go. approved: ' +
        'nothing needs changing. changes_requested: the author must fix what you commented on. ' +
        'commented: remarks that do not block. The review then waits for the author; follow ' +
        'with await_author unless you approved.',
      input_schema: {
        review_id: z.string(),
        verdict: z.enum(['approved', 'changes_requested', 'commented']),
        summary: z.string().optional().describe('The verdict as a whole, in a sentence or two.'),
        comments: z
          .array(
            z.object({
              path: z.string(),
              line: z.number().int().positive(),
              side: z
                .enum(['base', 'head'])
                .optional()
                .describe('"base" for a removed line, "head" (the default) for any other.'),
              body: z.string(),
            }),
          )
          .optional()
          .describe('New comments on lines, numbered as get_diff shows them.'),
        replies: z
          .array(z.object({ thread_id: z.string(), body: z.string() }))
          .optional()
          .describe('Answers to existing comments, by the id in brackets before each.'),
        reviewer_name: z
          .string()
          .optional()
          .describe('A short name to comment under, such as "claude-reviewer".'),
      },
    }),
    async ({ review_id, verdict, summary, comments, replies, reviewer_name }) =>
      guard(async () => {
        const review = await daemon.submitAsReviewer(review_id, {
          verdict,
          summary,
          comments,
          replies,
          reviewer_name,
        })
        const { ai_review_rounds } = await daemon.getSettings()
        const used = reviewerRounds(review)
        const next =
          verdict === 'approved'
            ? 'You approved it, so it goes to the person now. Your part is done.'
            : used >= ai_review_rounds
              ? 'That was your last round. Stop here: the person finishes the review.'
              : 'Call await_author to wait for the author to answer or advance, then read get_diff again.'
        return text(
          [renderVerdict(review), '', `Round ${used} of ${ai_review_rounds}.`, next].join('\n'),
        )
      }),
  )

  server.registerTool(
    'await_author',
    toolConfig({
      title: 'Wait for the author to answer',
      description:
        'For an AI reviewer: block until the author has answered your last verdict — advanced ' +
        'the review onto new work, or replied to a comment. Returns what is open if the wait ' +
        'times out, so a timeout is not a failure: call it again to keep waiting.',
      input_schema: {
        review_id: z.string(),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(`How long to wait before returning. Defaults to ${DEFAULT_WAIT_SECONDS}.`),
      },
    }),
    async ({ review_id, timeout_seconds }) =>
      guard(async () => {
        const current = await daemon.getReview(review_id)
        const verdict = latestSubmission(current)
        if (verdict === null || submissionAuthor(verdict) !== 'reviewer') {
          return failure(
            'There is no verdict of yours on this review to answer. Read it with get_diff and ' +
              'pass one with submit_verdict first.',
          )
        }
        const seconds = timeout_seconds ?? DEFAULT_WAIT_SECONDS
        const answered = await daemon.waitForAuthor(review_id, seconds * 1000)
        if (answered === null) {
          return text(
            `The author has not answered after ${seconds}s. Call await_author again to keep waiting.`,
          )
        }
        return text(
          [
            renderReviewWithThreads(answered, daemon.reviewUrl(answered.id)),
            '',
            'The author has answered. Read the changes with get_diff, check their replies above, ' +
              'resolve the comments they fixed with resolve_thread, and pass your next verdict ' +
              'with submit_verdict.',
          ].join('\n'),
        )
      }),
  )

  return server
}
