import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DaemonClient, type DaemonClientOptions } from './daemon-client.ts'
import {
  openThreads,
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

export const createMcpServer = (options: DaemonClientOptions = {}): McpServer => {
  const daemon = new DaemonClient(options)
  const server = new McpServer({ name: 'yart', version: '0.0.0' })

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
        if (review.files.length === 0) {
          return text(
            [
              renderReview(review, daemon.reviewUrl(review.id)),
              '',
              'Nothing differs between those two points, so there is nothing to review.',
              'If you meant to review committed work, pass a base such as HEAD~1 or main.',
            ].join('\n'),
          )
        }
        return text(
          [
            renderReview(review, daemon.reviewUrl(review.id)),
            '',
            'Ask the human to open that URL and review. Then call await_review with this id.',
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
        const verdict = renderVerdict(submitted)

        if (open.length === 0) {
          return text(`${verdict}\n\nNo open comments.`)
        }
        return text(
          [
            verdict,
            '',
            renderThreads(open, 'Open comments'),
            '',
            'Address these, commit, then call advance_review to re-anchor them onto your changes.',
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

  return server
}
