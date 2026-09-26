import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import type { CommentAuthor, DiffSide, FileContents, ReviewVerdict, Thread } from '@yart/core'
import { buildReviewDiff } from './diff.ts'
import { GitError, readBlob } from './git.ts'
import { Repositories } from './repositories.ts'
import { ReviewError, type SubmitParams } from './review.ts'

export interface ServerOptions {
  /** The repository a request is for when it does not say. */
  repo_path: string
  /** Where the repositories seen are remembered; null keeps them in memory. */
  state_dir?: string | null
  /** Built web UI to serve. Defaults to this workspace's `apps/web/dist`. */
  ui_dir?: string
}

/** Read once at start: a running daemon does not change version. */
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

const DEFAULT_UI_DIR = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url))

/**
 * Where this daemon's code lives, so a client can tell a daemon from its own
 * checkout apart from one belonging to another checkout or an installed yart.
 */
const CODE_DIR = fileURLToPath(new URL('..', import.meta.url))

interface SubmitBody {
  verdict?: ReviewVerdict
  body?: string
  threads?: unknown
  replies?: unknown
  expected_head_sha?: unknown
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

/**
 * Checks the drafted comments of a pending review before any of them is used.
 *
 * All of them are checked up front, because the service writes them in one go:
 * a malformed tenth comment should reject the submission, not arrive after
 * nine others were accepted.
 */
const parseDrafts = (body: SubmitBody): Pick<SubmitParams, 'threads' | 'replies'> => {
  const threads = body.threads ?? []
  const replies = body.replies ?? []
  if (!Array.isArray(threads) || !Array.isArray(replies)) {
    throw new ReviewError('threads and replies must be lists', 400)
  }

  const asRecord = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) {
      throw new ReviewError('Every drafted comment must be an object', 400)
    }
    return value as Record<string, unknown>
  }

  return {
    threads: threads.map((entry: unknown) => {
      const draft = asRecord(entry)
      if (typeof draft.path !== 'string' || typeof draft.line !== 'number') {
        throw new ReviewError('Every drafted comment needs a path and a line', 400)
      }
      if (!isNonEmptyString(draft.body)) {
        throw new ReviewError('Every drafted comment needs a body', 400)
      }
      if (draft.side !== undefined && draft.side !== 'base' && draft.side !== 'head') {
        throw new ReviewError('A drafted comment\'s side must be "base" or "head"', 400)
      }
      if (draft.blob_sha !== undefined && typeof draft.blob_sha !== 'string') {
        throw new ReviewError("A drafted comment's blob_sha must be a string", 400)
      }
      return {
        path: draft.path,
        line: draft.line,
        side: draft.side,
        body: draft.body,
        blob_sha: draft.blob_sha,
      }
    }),
    replies: replies.map((entry: unknown) => {
      const draft = asRecord(entry)
      if (typeof draft.thread_id !== 'string' || !isNonEmptyString(draft.body)) {
        throw new ReviewError('Every drafted reply needs a thread and a body', 400)
      }
      return { thread_id: draft.thread_id, body: draft.body }
    }),
  }
}

const VERDICTS: ReadonlySet<string> = new Set<ReviewVerdict>([
  'commented',
  'approved',
  'changes_requested',
])

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const NOT_BUILT =
  '<!doctype html><title>yart</title><p style="font-family:sans-serif">' +
  'The web UI has not been built. Run <code>pnpm build</code>, then reload.'

/**
 * Resolves a request path inside `ui_dir`, or null when it escapes.
 *
 * The daemon serves files from disk, so a path containing `..` must not be able
 * to reach outside the build directory.
 */
const resolveAsset = (ui_dir: string, request_path: string): string | null => {
  const relative = normalize(decodeURIComponent(request_path)).replace(/^[/\\]+/, '')
  if (relative === '' || relative.split(/[/\\]/).includes('..')) return null
  const full = join(ui_dir, relative)
  return full.startsWith(ui_dir + sep) ? full : null
}

interface ErrorBody {
  error: string
}

const statusFor = (cause: unknown): number => {
  if (cause instanceof ReviewError) return cause.status
  // A git failure here means a revision or path the caller named does not
  // exist, which is their mistake rather than the daemon's.
  if (cause instanceof GitError) return 400
  return 500
}

const messageFor = (cause: unknown): string => {
  return cause instanceof Error ? cause.message : 'Unexpected error'
}

export const createServer = ({
  repo_path,
  ui_dir = DEFAULT_UI_DIR,
  state_dir = null,
}: ServerOptions): Hono => {
  const repositories = new Repositories({ default_repo: repo_path, state_dir })
  const app = new Hono()

  app.onError((cause, context) => {
    const status = statusFor(cause)
    if (status === 500) console.error(cause)
    return context.json<ErrorBody>({ error: messageFor(cause) }, status as 400)
  })

  /**
   * Refuses a write that a web page could have sent.
   *
   * Browsers let a page on any site send a "simple" cross-origin POST — one
   * whose content type is plain text or a form — without asking first, and
   * the page cannot read the answer but the daemon still acts on it. Since the
   * daemon acts on any repository a request names, that would let any site
   * write reviews into any repository whose path it could guess. Requiring JSON
   * makes the request one a browser must ask permission for, and the daemon
   * never grants it: it sends no CORS headers at all.
   */
  app.use('/api/*', async (context, next) => {
    const method = context.req.method
    if (method === 'POST' || method === 'PATCH') {
      const type = context.req.header('content-type') ?? ''
      if (!type.toLowerCase().startsWith('application/json')) {
        return context.json<ErrorBody>(
          { error: 'Requests that change anything must be sent as application/json' },
          415,
        )
      }
    }
    await next()
  })

  // The version lets a client notice a daemon older than itself, which after an
  // update is the one still running; a daemon from before this field existed
  // also predates serving more than one repository.
  app.get('/health', (context) =>
    context.json({ ok: true, repo_path, version: VERSION, code_dir: CODE_DIR }),
  )

  app.get('/api/reviews', async (context) => {
    const archived = context.req.query('archived') === 'true'
    const lists = await Promise.all(
      (await repositories.all()).map((service) => service.list({ archived })),
    )
    // Newest first across every repository, as each list already is within one.
    return context.json(lists.flat().sort((a, b) => b.created_at.localeCompare(a.created_at)))
  })

  app.patch('/api/reviews/:id', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{ archived?: boolean }>()
    if (typeof body.archived !== 'boolean') {
      throw new ReviewError('archived must be true or false', 400)
    }
    return context.json(await service.setArchived(context.req.param('id'), body.archived))
  })

  app.post('/api/reviews', async (context) => {
    const body = await context.req.json<{
      base?: string
      head?: string
      title?: string
      repo_path?: string
    }>()
    if (body.repo_path !== undefined && typeof body.repo_path !== 'string') {
      throw new ReviewError('repo_path must be a path', 400)
    }
    const { service, repo_root } = await repositories.resolve(body.repo_path)
    // Defaults to uncommitted work against HEAD, which is what an agent that has
    // just finished editing wants and cannot express as a revision range.
    const review = await service.create({
      repo_path: repo_root,
      base: body.base === undefined || body.base === '' ? 'HEAD' : body.base,
      head: body.head,
      title: body.title,
    })
    return context.json(review, 201)
  })

  app.get('/api/reviews/:id', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    return context.json(await service.get(context.req.param('id')))
  })

  app.delete('/api/reviews/:id', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    await service.remove(context.req.param('id'))
    return context.body(null, 204)
  })

  /**
   * Both sides of a file, for rendering. Path arrives as a query parameter
   * rather than a path segment so that nested paths need no encoding.
   */
  app.get('/api/reviews/:id/file', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const review = await service.get(context.req.param('id'))
    const path = context.req.query('path')
    if (path === undefined) throw new ReviewError('A path is required', 400)

    const file = review.files.find((candidate) => candidate.path === path)
    if (file === undefined) throw new ReviewError(`${path} is not part of this review`, 404)

    const [base_content, head_content] = await Promise.all([
      file.base_blob_sha === null ? null : readBlob(review.repo_path, file.base_blob_sha),
      file.head_blob_sha === null ? null : readBlob(review.repo_path, file.head_blob_sha),
    ])

    return context.json<FileContents>({ ...file, base_content, head_content })
  })

  /** Every file's hunks, built by git so the rendering matches what anchors use. */
  app.get('/api/reviews/:id/diff', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const review = await service.get(context.req.param('id'))
    return context.json(await buildReviewDiff(review.repo_path, review.files))
  })

  app.post('/api/reviews/:id/threads', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{
      path?: string
      line?: number
      side?: DiffSide
      body?: string
      author?: CommentAuthor
    }>()

    if (typeof body.path !== 'string' || typeof body.line !== 'number') {
      throw new ReviewError('A path and a line are required', 400)
    }
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      throw new ReviewError('A comment body is required', 400)
    }

    const review = await service.addThread(context.req.param('id'), {
      path: body.path,
      line: body.line,
      side: body.side,
      body: body.body,
      author: body.author,
    })
    return context.json(review, 201)
  })

  app.post('/api/reviews/:id/threads/:thread_id/comments', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{ body?: string; author?: CommentAuthor }>()
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      throw new ReviewError('A comment body is required', 400)
    }

    return context.json(
      await service.addComment(
        context.req.param('id'),
        context.req.param('thread_id'),
        body.body,
        body.author,
      ),
      201,
    )
  })

  app.patch('/api/reviews/:id/threads/:thread_id', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{ status?: Thread['status'] }>()
    if (body.status !== 'open' && body.status !== 'resolved') {
      throw new ReviewError('Status must be "open" or "resolved"', 400)
    }

    return context.json(
      await service.setThreadStatus(
        context.req.param('id'),
        context.req.param('thread_id'),
        body.status,
      ),
    )
  })

  /** A reply under a verdict, which unlike a line comment has no thread. */
  app.post('/api/reviews/:id/submissions/:submission_id/comments', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{ body?: string; author?: CommentAuthor }>()
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      throw new ReviewError('A comment body is required', 400)
    }

    return context.json(
      await service.addSubmissionComment(
        context.req.param('id'),
        context.req.param('submission_id'),
        body.body,
        body.author,
      ),
      201,
    )
  })

  app.post('/api/reviews/:id/submit', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    // Annotated rather than asserted: a missing body is a valid submission, so
    // the empty object has to widen to the parameter type without a cast.
    const body: SubmitBody = await context.req.json<SubmitBody>().catch(() => ({}))

    if (body.verdict !== undefined && !VERDICTS.has(body.verdict)) {
      throw new ReviewError('Verdict must be "commented", "approved" or "changes_requested"', 400)
    }

    if (body.expected_head_sha !== undefined && typeof body.expected_head_sha !== 'string') {
      throw new ReviewError('expected_head_sha must be a string', 400)
    }

    return context.json(
      await service.submit(context.req.param('id'), {
        verdict: body.verdict,
        body: body.body,
        ...parseDrafts(body),
        expected_head_sha: body.expected_head_sha,
      }),
    )
  })

  app.post('/api/reviews/:id/advance', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{ head?: string }>().catch(() => ({ head: undefined }))
    return context.json(await service.advanceHead(context.req.param('id'), body.head))
  })

  /**
   * The web UI, last so every API route wins.
   *
   * Unknown paths fall back to index.html rather than 404ing, because the UI
   * routes client-side: a deep link like /reviews/<id> is a real page there and
   * nothing on disk.
   */
  app.get('/*', async (context) => {
    const asset = resolveAsset(ui_dir, new URL(context.req.url).pathname)
    if (asset !== null) {
      const body = await readFile(asset).catch(() => null)
      if (body !== null) {
        const type = CONTENT_TYPES[extname(asset)] ?? 'application/octet-stream'
        return context.body(new Uint8Array(body), 200, { 'content-type': type })
      }
    }

    const index = await readFile(join(ui_dir, 'index.html'), 'utf8').catch(() => null)
    if (index === null) {
      return context.html(NOT_BUILT, 503)
    }
    return context.html(index)
  })

  return app
}
