import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { latestSubmission, reviewerRounds, submissionAuthor, type Settings } from '@yart/core'
import { VERSION, type Review } from '@yart/daemon'
import { DaemonClient, DEFAULT_PORT, type DaemonClientOptions } from './daemon-client.ts'
import { browserOpeningEnabled, openReview } from './open-browser.ts'
import {
  openThreads,
  ImageNumbers,
  renderDiff,
  renderReview,
  renderReviewLine,
  renderReviewWithThreads,
  renderThreads,
  renderVerdict,
} from './render.ts'

const DEFAULT_WAIT_SECONDS = 300

/** The parameter that attaches image files to a comment. */
const imagePaths = () =>
  z
    .array(z.string())
    .optional()
    .describe(
      'Image files to attach, for example screenshots that show your fix. Use PNG, JPEG, ' +
        'WebP or GIF, 5 MB at most for each file. A relative path starts at the repository.',
    )

/** The most images that one result gives. Each image goes into the context of the agent. */
const MAX_IMAGES = 10

/** The rules that the MCP client gives to the agent with the tools. */
const INSTRUCTIONS = [
  'yart is a local code review tool. Obey these rules:',
  '- When the person asks to review changes, call start_review. Do not ask how they want to review.',
  '- After start_review and advance_review, wait for the verdict at once. Do not wait for the ' +
    'person to tell you. Their results tell you how to wait.',
  '- When yart opens the review for the person, do not send the review URL.',
  '- When you fix a problem that the person can see, such as a UI change, attach a ' +
    'screenshot of the fix with image_paths.',
  '- To review the work of a different agent, use the reviewer tools: get_reviewer_settings, ' +
    'get_diff, submit_verdict and await_author.',
].join('\n')
const MAX_WAIT_SECONDS = 1800

/* eslint-disable @typescript-eslint/naming-convention -- MCP wire field names */
type ContentBlock =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type ToolResult = { content: ContentBlock[]; isError?: boolean }

/**
 * Makes a tool config, with the `inputSchema` spelling of the protocol in one
 * place. It is generic, thus `registerTool` still gets the argument types of
 * the handler from the schema.
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
 * What the agent under review must know about a verdict of an AI reviewer. The
 * person did not see the work yet. When the reviewer has no more rounds, the
 * next step belongs to the person, and is not one more fix.
 */
const reviewerNote = (review: Review, settings: Settings): string | null => {
  const verdict = latestSubmission(review)
  if (verdict === null || submissionAuthor(verdict) !== 'reviewer') return null
  if (verdict.verdict === 'approved') {
    return 'An AI reviewer approved this. The person did not examine it yet. Tell the person that it is ready for their review.'
  }
  if (reviewerRounds(review) >= settings.ai_review_rounds) {
    return (
      'The AI reviewer used its last round. Do not make more changes for it. ' +
      'Tell the person that they must complete the review, and tell them which comments are open.'
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
 * Each tool runs through this function. Thus a failure of the daemon or of git
 * gets to the model as a message that it can read and act on. Without it, an
 * error in the transport would stop the tool call with no explanation.
 */
const guard = async (run: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await run()
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : 'An unknown error occurred.')
  }
}

export interface McpServerOptions extends DaemonClientOptions {
  /**
   * Shows a new review to the person who must read it.
   *
   * Tests can replace it, and see the calls with no window on the screen of the
   * person who runs them. The environment decides if it is called, not this
   * option.
   */
  openBrowser?: (url: string) => void
}

export const createMcpServer = (options: McpServerOptions = {}): McpServer => {
  const daemon = new DaemonClient(options)
  const server = new McpServer({ name: 'yart', version: VERSION }, { instructions: INSTRUCTIONS })

  const port = options.port ?? DEFAULT_PORT
  const openBrowser = options.openBrowser ?? ((url: string) => openReview(url, port))
  const opening_enabled = browserOpeningEnabled()
  // When yart opens the review for the person, the agent does not get the URL.
  // An agent repeats a URL in the chat, and the person does not need it there.
  /**
   * How to wait for the verdict. A background command keeps the turn of the
   * agent free while the person reviews. `await_review` works in each client.
   */
  const waitHint = (review_id: string): string =>
    'Then wait for the verdict. If you can run a shell command in the background, run ' +
    `\`yart await ${review_id}${port === DEFAULT_PORT ? '' : ` --port ${port}`}\` in the ` +
    'background, and call get_review when it stops. Else call await_review with this id.'

  const shownUrl = (review_id: string): string | null =>
    opening_enabled ? null : daemon.reviewUrl(review_id)

  /**
   * The text, then each image that the text numbered. The agent sees the images
   * of the person, not only the words.
   */
  const withImages = async (
    review_id: string,
    body: string,
    images: ImageNumbers,
  ): Promise<ToolResult> => {
    const content: ContentBlock[] = [{ type: 'text', text: body }]
    for (const [index, attachment] of images.attachments.slice(0, MAX_IMAGES).entries()) {
      const data = await daemon.getAttachment(review_id, attachment.id).catch(() => null)
      if (data === null) continue
      content.push(
        { type: 'text', text: `Image ${index + 1}:` },
        // eslint-disable-next-line @typescript-eslint/naming-convention -- MCP wire field
        { type: 'image', data, mimeType: attachment.media_type },
      )
    }
    if (images.attachments.length > MAX_IMAGES) {
      content.push({
        type: 'text',
        text: `The result shows ${MAX_IMAGES} of ${images.attachments.length} images.`,
      })
    }
    return { content }
  }

  server.registerTool(
    'start_review',
    toolConfig({
      title: 'Start a review',
      description:
        'Open a code review of your changes for the person. Call this when you complete ' +
        'your changes. You do not have to commit them. Also call this when the person asks ' +
        'to review changes. By default, the review shows all changes in the files on disk, ' +
        'also new files. Then wait for the verdict, as the result tells you.',
      input_schema: {
        base: z
          .string()
          .optional()
          .describe(
            'The revision to compare from, for example a branch name, a commit sha or HEAD~3. ' +
              'The default is HEAD. HEAD is correct for changes that are not committed.',
          ),
        head: z
          .string()
          .optional()
          .describe(
            'The revision to compare to. The default is "working": the files on disk, ' +
              'committed or not. For committed work, give a revision.',
          ),
        title: z
          .string()
          .optional()
          .describe(
            'A short name for the review. The list of reviews shows it. The default is the ' +
              'subject of the head commit. Give a name when the subject does not identify ' +
              'the review.',
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
              renderReview(review, shownUrl(review.id)),
              '',
              'The two revisions are the same. Thus there is nothing to review.',
              'To review committed work, give a base, for example HEAD~1 or main.',
            ].join('\n'),
          )
        }

        // An empty review does not need a window. Thus this comes after the check
        // above, not next to the call that made the review.
        if (opening_enabled) openBrowser(url)

        return text(
          [
            renderReview(review, shownUrl(review.id)),
            '',
            opening_enabled
              ? 'yart opened the review for the person. Tell them in one short sentence that ' +
                'it is open. Do not send the URL.'
              : 'Ask the person to open the URL and review the changes.',
            waitHint(review.id),
          ].join('\n'),
        )
      }),
  )

  server.registerTool(
    'await_review',
    toolConfig({
      title: 'Wait for the verdict of the person',
      description:
        'Wait until the person submits the review. Then get their verdict and open comments. ' +
        'If the time stops first, you get the comments so far. That is not an error. ' +
        'Call it again to wait more.',
      input_schema: {
        review_id: z.string().describe('The id that start_review gave.'),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(
            `The maximum time to wait, in seconds. The default is ${DEFAULT_WAIT_SECONDS}.`,
          ),
      },
    }),
    async ({ review_id, timeout_seconds }) =>
      guard(async () => {
        const seconds = timeout_seconds ?? DEFAULT_WAIT_SECONDS
        const submitted = await daemon.waitForSubmission(review_id, seconds * 1000)

        if (submitted === null) {
          const pending = await daemon.getReview(review_id)
          const pending_images = new ImageNumbers()
          return withImages(
            review_id,
            [
              `The person did not submit the review in ${seconds} seconds. Call await_review again to wait more.`,
              '',
              renderThreads(openThreads(pending), 'Comments so far', pending_images),
            ].join('\n'),
            pending_images,
          )
        }

        const open = openThreads(submitted)
        const note = reviewerNote(submitted, await daemon.getSettings())
        const images = new ImageNumbers()
        const rendered = renderVerdict(submitted, images)
        const verdict = note === null ? rendered : `${rendered}\n\n${note}`

        if (open.length === 0) {
          return withImages(
            review_id,
            [
              verdict,
              '',
              'No open comments.',
              'To answer the summary, use reply_to_verdict. Thus the answer goes into the review.',
            ].join('\n'),
            images,
          )
        }
        return withImages(
          review_id,
          [
            verdict,
            '',
            renderThreads(open, 'Open comments', images),
            '',
            'Fix these comments. Then call advance_review, to move the comments onto your changes.',
            'To answer a comment, use reply_to_thread. To answer the verdict, use reply_to_verdict.',
          ].join('\n'),
          images,
        )
      }),
  )

  server.registerTool(
    'get_review',
    toolConfig({
      title: 'Read a review',
      description:
        'Read a review and its open comments at once, with no wait. To wait for the ' +
        'verdict of the person, use await_review.',
      input_schema: { review_id: z.string().describe('The id that start_review gave.') },
    }),
    async ({ review_id }) =>
      guard(async () => {
        const review = await daemon.getReview(review_id)
        const images = new ImageNumbers()
        return withImages(
          review_id,
          renderReviewWithThreads(review, shownUrl(review.id), images),
          images,
        )
      }),
  )

  server.registerTool(
    'list_reviews',
    toolConfig({
      title: 'List reviews',
      description: 'List the reviews of this repository. The newest review is first.',
      input_schema: {},
    }),
    async () =>
      guard(async () => {
        const reviews = await daemon.listReviews()
        if (reviews.length === 0) return text('This repository has no reviews.')
        return text(reviews.map(renderReviewLine).join('\n'))
      }),
  )

  server.registerTool(
    'reply_to_thread',
    toolConfig({
      title: 'Answer a comment',
      description:
        'Answer a comment thread. Use it to tell what you changed, or to give the reason ' +
        'when you do not agree with the comment.',
      input_schema: {
        review_id: z.string(),
        thread_id: z.string().describe('The id in brackets before each comment.'),
        body: z.string().describe('The text of the answer.'),
        image_paths: imagePaths(),
      },
    }),
    async ({ review_id, thread_id, body, image_paths }) =>
      guard(async () => {
        const attachments = await daemon.uploadImages(review_id, image_paths)
        await daemon.replyToThread(review_id, thread_id, body, attachments)
        return text(`You answered ${thread_id}.`)
      }),
  )

  server.registerTool(
    'reply_to_verdict',
    toolConfig({
      title: 'Answer the verdict',
      description:
        'Answer the summary of the verdict, not a comment on a line. Use it to tell what ' +
        'you did about the verdict, to tell about work that you already completed, or to ' +
        'give the reason when you do not agree. Thus the answer goes into the review, not ' +
        'only into the chat.',
      input_schema: {
        review_id: z.string(),
        body: z.string().describe('The text of the answer.'),
        submission_id: z
          .string()
          .optional()
          .describe(
            'The id in brackets next to the verdict. The default is the newest verdict, ' +
              'which is the verdict that you got last.',
          ),
        image_paths: imagePaths(),
      },
    }),
    async ({ review_id, body, submission_id, image_paths }) =>
      guard(async () => {
        let target = submission_id
        if (target === undefined) {
          const review = await daemon.getReview(review_id)
          const submission = latestSubmission(review)
          if (submission === null) {
            return text('This review has no verdict yet. Thus there is no verdict to answer.')
          }
          target = submission.id
        }
        const attachments = await daemon.uploadImages(review_id, image_paths)
        await daemon.replyToVerdict(review_id, target, body, attachments)
        return text(`You answered the verdict on ${review_id}.`)
      }),
  )

  server.registerTool(
    'resolve_thread',
    toolConfig({
      title: 'Resolve a comment',
      description:
        'Mark a comment thread as fixed. If the fix is not clear from the code, answer ' +
        'the thread first. Thus the person can see what you did.',
      input_schema: {
        review_id: z.string(),
        thread_id: z.string().describe('The id in brackets before each comment.'),
      },
    }),
    async ({ review_id, thread_id }) =>
      guard(async () => {
        await daemon.setThreadStatus(review_id, thread_id, 'resolved')
        return text(`${thread_id} is resolved.`)
      }),
  )

  server.registerTool(
    'advance_review',
    toolConfig({
      title: 'Move the review onto your new changes',
      description:
        'Move all comments onto your newest changes. Call this after you fix the comments, ' +
        'committed or not. Each comment follows its line. When you changed that line, the ' +
        'comment becomes outdated. The review opens again for the person.',
      input_schema: {
        review_id: z.string(),
        head: z
          .string()
          .optional()
          .describe(
            'The revision to compare to now. The default is the same kind of head as before. ' +
              'Thus a review of changes that are not committed reads the files on disk again.',
          ),
      },
    }),
    async ({ review_id, head }) =>
      guard(async () => {
        const review = await daemon.advanceReview(review_id, head)
        return text(
          [
            renderReviewWithThreads(review, shownUrl(review.id)),
            '',
            'Tell the person that the review is ready again.',
            waitHint(review.id),
          ].join('\n'),
        )
      }),
  )

  // The side of the reviewer. One MCP server serves the two sides. Thus these
  // tools say clearly that they are for a review of the work of a different
  // agent. An agent whose own change is under review must not give a verdict.

  server.registerTool(
    'get_reviewer_settings',
    toolConfig({
      title: 'Read the settings of the AI reviewer',
      description:
        'Read how the person wants an AI reviewer to work: the model, the effort, the ' +
        'instructions and the number of verdicts for each review. Call this before you start ' +
        'a reviewer, as a subagent or as a different session. Start it on that model and ' +
        'effort, if your tool allows it. Give it the instructions.',
      input_schema: {},
    }),
    async () =>
      guard(async () =>
        text(
          [
            describeSettings(await daemon.getSettings()),
            '',
            'The reviewer uses get_diff, submit_verdict and await_author. The reviewer must not ' +
              'be the agent whose work it reviews.',
          ].join('\n'),
        ),
      ),
  )

  server.registerTool(
    'get_diff',
    toolConfig({
      title: 'Read the changes of a review',
      description:
        'For an AI reviewer of the work of a different agent. Read the changes of a review as ' +
        'a diff. Each line has its base and head line numbers, for your comments. Read it ' +
        'before each submit_verdict, because the author can move the review.',
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
      title: 'Give a verdict as an AI reviewer',
      description:
        'Only for an AI reviewer. Do not use it on your own work. Give a verdict on a review, ' +
        'with all your line comments and answers in one call. approved: nothing must change. ' +
        'changes_requested: the author must fix your comments. commented: your comments do ' +
        'not stop the work. Then the review waits for the author. If you did not approve, ' +
        'call await_author.',
      input_schema: {
        review_id: z.string(),
        verdict: z.enum(['approved', 'changes_requested', 'commented']),
        summary: z
          .string()
          .optional()
          .describe('The summary of the verdict, in one or two sentences.'),
        image_paths: imagePaths(),
        comments: z
          .array(
            z.object({
              path: z.string(),
              line: z.number().int().positive(),
              side: z
                .enum(['base', 'head'])
                .optional()
                .describe(
                  '"base" for a removed line. "head" for all other lines. The default is "head".',
                ),
              body: z.string(),
              image_paths: imagePaths(),
            }),
          )
          .optional()
          .describe('New comments on lines. Use the line numbers that get_diff shows.'),
        replies: z
          .array(z.object({ thread_id: z.string(), body: z.string(), image_paths: imagePaths() }))
          .optional()
          .describe('Answers to comments that exist. Use the id in brackets before each comment.'),
        reviewer_name: z
          .string()
          .optional()
          .describe('A short name for your comments, for example "claude-reviewer".'),
      },
    }),
    async ({ review_id, verdict, summary, image_paths, comments, replies, reviewer_name }) =>
      guard(async () => {
        const review = await daemon.submitAsReviewer(review_id, {
          verdict,
          summary,
          attachments: await daemon.uploadImages(review_id, image_paths),
          comments:
            comments === undefined
              ? undefined
              : await Promise.all(
                  comments.map(async ({ image_paths: paths, ...comment }) => ({
                    ...comment,
                    attachments: await daemon.uploadImages(review_id, paths),
                  })),
                ),
          replies:
            replies === undefined
              ? undefined
              : await Promise.all(
                  replies.map(async ({ image_paths: paths, ...reply }) => ({
                    ...reply,
                    attachments: await daemon.uploadImages(review_id, paths),
                  })),
                ),
          reviewer_name,
        })
        const { ai_review_rounds } = await daemon.getSettings()
        const used = reviewerRounds(review)
        const next =
          verdict === 'approved'
            ? 'You approved it. Thus it goes to the person now. Your work is complete.'
            : used >= ai_review_rounds
              ? 'That was your last round. Stop now. The person completes the review.'
              : 'Wait for the answer of the author. If you can run a shell command in the ' +
                'background, run ' +
                `\`yart await ${review_id} --author${port === DEFAULT_PORT ? '' : ` --port ${port}`}\`` +
                ' in the background. Else call await_author. Then read get_diff again.'
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
        'For an AI reviewer. Wait until the author answers your last verdict: the author moves ' +
        'the review onto new work, or answers a comment. If the time stops first, you get the ' +
        'open comments. That is not an error. Call it again to wait more.',
      input_schema: {
        review_id: z.string(),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(
            `The maximum time to wait, in seconds. The default is ${DEFAULT_WAIT_SECONDS}.`,
          ),
      },
    }),
    async ({ review_id, timeout_seconds }) =>
      guard(async () => {
        const current = await daemon.getReview(review_id)
        const verdict = latestSubmission(current)
        if (verdict === null || submissionAuthor(verdict) !== 'reviewer') {
          return failure(
            'You did not give a verdict on this review. Read the changes with get_diff. Then ' +
              'give a verdict with submit_verdict.',
          )
        }
        const seconds = timeout_seconds ?? DEFAULT_WAIT_SECONDS
        const answered = await daemon.waitForAuthor(review_id, seconds * 1000)
        if (answered === null) {
          return text(
            `The author did not answer in ${seconds} seconds. Call await_author again to wait more.`,
          )
        }
        const images = new ImageNumbers()
        return withImages(
          review_id,
          [
            renderReviewWithThreads(answered, shownUrl(answered.id), images),
            '',
            'The author answered. Do these steps: read the changes with get_diff, and read the ' +
              'answers above. Resolve each fixed comment with resolve_thread. Give your next ' +
              'verdict with submit_verdict.',
          ].join('\n'),
          images,
        )
      }),
  )

  return server
}
