import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono, type Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { parse as parseCookies } from 'hono/utils/cookie'
import {
  hasControlCharacters,
  latestSubmission,
  submissionAuthor,
  type CommentAuthor,
  type SubmissionAuthor,
  type DiffSide,
  type FileContents,
  type ReviewVerdict,
  type Thread,
} from '@yart/core'
import { healthProof, makeToken, sameSecret } from './auth.ts'
import { buildReviewDiff } from './diff.ts'
import { GitError, readBlob } from './git.ts'
import { Repositories } from './repositories.ts'
import { ReviewError, type SubmitParams } from './review.ts'
import { SettingsStore } from './settings.ts'
import { VERSION } from './version.ts'

/**
 * The secrets of the daemon. Each `/api` request must have one of them.
 */
export interface ServerAuth {
  /** The token of the clients: the CLI, the commit hook and the MCP server. It is in a file. */
  token: string
  /**
   * The token of the window of the person. The window gets it in a cookie, from
   * a sign-in link. The daemon never writes it to a file. Only a request with it
   * can write as the person, change the settings, or archive or delete a review.
   */
  ui_token: string
  /** The name of the cookie. A cookie does not belong to one port, thus the name has the port. */
  cookie_name: string
}

export interface ServerOptions {
  auth: ServerAuth
  /** The repository for a request that does not name one, or null for none. */
  repo_path: string | null
  /** Where the daemon records the repositories that it served. Null keeps them in memory. */
  state_dir?: string | null
  /** The built web UI to serve. The default is `apps/web/dist` of this workspace. */
  ui_dir?: string
  /** How long after an approval the daemon does the action of the settings. */
  approval_grace_ms?: number
  /** Stops the process. Without it, the daemon refuses `POST /api/shutdown`. */
  shutdown?: () => void
}

/**
 * An agent that waits in `await_review` polls every few seconds. This time is
 * long enough for that agent to read the approval before the review is
 * archived or deleted.
 */
const APPROVAL_GRACE_MS = 60_000

/** How long a sign-in link works. A link works one time only. */
const SIGN_IN_CODE_MS = 5 * 60_000

/** The most sign-in links that can wait at one time. */
const MAX_SIGN_IN_CODES = 100

/**
 * Who sent a request. `person` is the window of the person. `client` is a
 * process with the token file: the CLI, the hook or an MCP server.
 */
type Role = 'person' | 'client'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Hono's own type shape
export type ServerEnv = { Variables: { role: Role } }

const DEFAULT_UI_DIR = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url))

/**
 * Where the code of this daemon is. Thus a client can tell a daemon from its own
 * checkout apart from a daemon of a different checkout or of an installed yart.
 */
const CODE_DIR = fileURLToPath(new URL('..', import.meta.url))

interface SubmitBody {
  verdict?: ReviewVerdict
  author?: unknown
  author_name?: unknown
  body?: string
  attachments?: unknown
  threads?: unknown
  replies?: unknown
  expected_head_sha?: unknown
}

const AUTHORS: ReadonlySet<string> = new Set<CommentAuthor>(['human', 'agent', 'reviewer'])

/** Long enough for the name of each reviewer, and short enough to show next to a comment. */
const MAX_AUTHOR_NAME = 64

interface Speaker {
  author: CommentAuthor
  author_name: string | null
}

/**
 * Who a request speaks for. The daemon examines this and does not trust it,
 * because the author decides how a comment shows and counts. Only an AI reviewer
 * has a name. The person and the agent are each one party.
 */
const parseSpeaker = (
  body: { author?: unknown; author_name?: unknown },
  role: Role,
  allowed: ReadonlySet<string> = AUTHORS,
): Speaker => {
  // A client must say who it speaks for. Only the window of the person can
  // leave it out, and only that window can write as the person.
  const author = body.author ?? (role === 'person' ? 'human' : undefined)
  if (typeof author !== 'string' || !allowed.has(author)) {
    throw new ReviewError(`author must be one of ${[...allowed].join(', ')}`, 400)
  }
  if (author === 'human' && role !== 'person') {
    throw new ReviewError('Only the yart window can write as the person.', 403)
  }
  const raw_name = body.author_name ?? null
  if (raw_name === null) return { author: author as CommentAuthor, author_name: null }
  if (author !== 'reviewer') {
    throw new ReviewError('author_name is only for an AI reviewer', 400)
  }
  if (typeof raw_name !== 'string' || raw_name.trim() === '') {
    throw new ReviewError('author_name must be a name', 400)
  }
  // A line break in a name would start a new line in the text that an agent reads.
  if (hasControlCharacters(raw_name)) {
    throw new ReviewError('author_name must be one line, with no control characters', 400)
  }
  const author_name = raw_name.trim()
  if (author_name.length > MAX_AUTHOR_NAME) {
    throw new ReviewError(`author_name must be at most ${MAX_AUTHOR_NAME} characters`, 400)
  }
  return { author: 'reviewer', author_name }
}

/** Only the person or an AI reviewer gives a verdict. The agent under review does not. */
const SUBMITTERS: ReadonlySet<string> = new Set(['human', 'reviewer'])

/** The names of this computer that a request to the daemon can use. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The name in a `Host` header, without the port, in lowercase. */
export const hostName = (host: string): string => {
  const trimmed = host.trim().toLowerCase()
  if (trimmed.startsWith('[')) return trimmed.slice(0, trimmed.indexOf(']') + 1)
  return trimmed.split(':')[0] ?? trimmed
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

/**
 * Examines the draft comments of a pending review before the daemon uses any of
 * them.
 *
 * It examines all of them first, because the service writes them in one write.
 * A bad tenth comment must stop the submission. It must not come after the
 * daemon accepted nine others.
 */
/** The ids of the images of a comment. Each id must be a string. */
const parseAttachmentIds = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
    throw new ReviewError('attachments must be a list of image ids', 400)
  }
  return value
}

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
        attachments: parseAttachmentIds(draft.attachments),
      }
    }),
    replies: replies.map((entry: unknown) => {
      const draft = asRecord(entry)
      if (typeof draft.thread_id !== 'string' || !isNonEmptyString(draft.body)) {
        throw new ReviewError('Every drafted reply needs a thread and a body', 400)
      }
      return {
        thread_id: draft.thread_id,
        body: draft.body,
        attachments: parseAttachmentIds(draft.attachments),
      }
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
 * Finds the file for a request path in `ui_dir`. Returns null when the path goes
 * outside it.
 *
 * The daemon serves files from the disk. Thus a path with `..` must not get to
 * files outside the build directory.
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
  // A git failure here means that a revision or a path from the caller does not
  // exist. The caller made the mistake, not the daemon.
  if (cause instanceof GitError) return 400
  return 500
}

const messageFor = (cause: unknown): string => {
  return cause instanceof Error ? cause.message : 'Unexpected error'
}

const SIGN_IN_FAILED =
  '<!doctype html><title>yart</title><p style="font-family:sans-serif">' +
  'This sign-in link does not work now. A link works one time, for a short time. ' +
  'Run <code>yart open</code> in a terminal to get a new link.'

/** The page after a sign-in. Only a path on this daemon, thus the link cannot send the person away. */
const safeNext = (next: string | undefined): string =>
  next !== undefined && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
    ? next
    : '/'

/** Refuses a request that does not come from the window of the person. */
const requirePerson = (context: Context<ServerEnv>): void => {
  if (context.get('role') !== 'person') {
    throw new ReviewError('Only the yart window can do this.', 403)
  }
}

export const createServer = ({
  auth,
  repo_path,
  ui_dir = DEFAULT_UI_DIR,
  state_dir = null,
  approval_grace_ms = APPROVAL_GRACE_MS,
  shutdown,
}: ServerOptions): Hono<ServerEnv> => {
  const repositories = new Repositories({ default_repo: repo_path, state_dir })
  const settings = new SettingsStore(state_dir)
  const app = new Hono<ServerEnv>()
  /** The sign-in codes that wait, with the time when each stops working. */
  const sign_in_codes = new Map<string, number>()

  /**
   * Archives or deletes a review some time after its approval, as the settings
   * tell. The daemon examines this again when the time comes. It does not decide
   * now. The setting can change. A review that was opened again, or approved
   * again, gets the newer verdict.
   */
  const settleApproval = (review_id: string, submission_id: string) => {
    const timer = setTimeout(() => {
      void (async () => {
        const { on_approve } = await settings.read()
        if (on_approve === 'keep') return
        const service = await repositories.locate(review_id)
        const review = await service.get(review_id)
        const latest = latestSubmission(review)
        if (latest?.id !== submission_id || latest.verdict !== 'approved') return
        if (on_approve === 'delete') await service.remove(review_id)
        else if (review.archived_at === null) await service.setArchived(review_id, true)
      })().catch(() => {
        // Most possibly, someone deleted the review by hand. Nothing remains to do.
      })
    }, approval_grace_ms)
    // A clean-up that waits is not a reason to keep the process alive.
    timer.unref()
  }

  app.onError((cause, context) => {
    const status = statusFor(cause)
    if (status === 500) console.error(cause)
    return context.json<ErrorBody>({ error: messageFor(cause) }, status as 400)
  })

  /**
   * Refuses a request that a browser sent to a name other than this computer.
   *
   * A web page can make its own domain name point to `127.0.0.1`. Then the
   * browser sends the requests of the page to the daemon, and lets the page
   * read the answers, because the origin is the same. The answers include file
   * contents. The browser still sends the name of the page in `Host`. Thus the
   * daemon answers only the names of this computer.
   *
   * A request with no `Host` does not come from a browser, because a browser
   * always sends it. Such a request cannot do this attack, thus it can pass.
   */
  app.use('*', async (context, next) => {
    const host = context.req.header('host')
    if (host !== undefined && !LOCAL_HOSTS.has(hostName(host))) {
      return context.json<ErrorBody>(
        { error: `yart answers only requests to localhost, not to ${hostName(host)}.` },
        403,
      )
    }
    await next()
  })

  /**
   * Refuses a request with no token.
   *
   * The Host check and the JSON rule stop web pages, but not a process on this
   * computer. Loopback TCP does not check the user account. Thus a process of a
   * different user, or a process in a sandbox, could control the daemon without
   * this check.
   */
  app.use('/api/*', async (context, next) => {
    const cookie = parseCookies(context.req.header('cookie') ?? '', auth.cookie_name)[
      auth.cookie_name
    ]
    const bearer = /^Bearer (\S+)$/i.exec(context.req.header('authorization') ?? '')?.[1]
    if (cookie !== undefined && sameSecret(cookie, auth.ui_token)) {
      context.set('role', 'person')
    } else if (bearer !== undefined && sameSecret(bearer, auth.token)) {
      context.set('role', 'client')
    } else {
      return context.json<ErrorBody>(
        { error: 'yart needs a sign-in for this request. Run yart open in a terminal.' },
        401,
      )
    }
    await next()
  })

  /**
   * Refuses a write that a web page could send.
   *
   * A page on any site can send a "simple" POST across origins, with plain text
   * or a form as its content type. The browser does not ask first. The page
   * cannot read the answer, but the daemon would still do the action. The daemon
   * acts on each repository that a request names. Thus any site could write
   * reviews into each repository whose path it could guess. With JSON required,
   * the browser must ask for permission first. The daemon never gives it,
   * because it sends no CORS headers.
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

  // The version lets a client see a daemon that is older than the client. After
  // an update, the old daemon still runs. A daemon from before this field
  // existed also served only one repository.
  //
  // A client sends a challenge. The proof tells the client that this process
  // knows the token, before the client sends the token.
  app.get('/health', (context) => {
    const challenge = context.req.query('challenge')
    const proof =
      challenge !== undefined && challenge.length > 0 && challenge.length <= 128
        ? healthProof(auth.token, challenge)
        : undefined
    return context.json({ ok: true, repo_path, version: VERSION, code_dir: CODE_DIR, proof })
  })

  /**
   * A one-time code for a sign-in link. A client with the token gets it, and
   * opens the link for the person. The code goes into a URL, thus it works only
   * one time and for a short time.
   */
  app.post('/api/sign-in-codes', (context) => {
    const now = Date.now()
    for (const [code, expires_at] of sign_in_codes) {
      if (expires_at <= now || sign_in_codes.size >= MAX_SIGN_IN_CODES) {
        sign_in_codes.delete(code)
      }
    }
    const code = makeToken()
    sign_in_codes.set(code, now + SIGN_IN_CODE_MS)
    return context.json({ code }, 201)
  })

  /** Gives the window of the person its cookie, for a code from `/api/sign-in-codes`. */
  app.get('/sign-in', (context) => {
    const code = context.req.query('code') ?? ''
    const expires_at = sign_in_codes.get(code)
    sign_in_codes.delete(code)
    if (expires_at === undefined || expires_at <= Date.now()) {
      return context.html(SIGN_IN_FAILED, 403)
    }
    setCookie(context, auth.cookie_name, auth.ui_token, {
      path: '/',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Hono's option name
      httpOnly: true,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Hono's option name
      sameSite: 'Strict',
    })
    return context.redirect(safeNext(context.req.query('next')), 303)
  })

  app.get('/api/version', (context) => context.json({ version: VERSION }))

  // `yart stop` and `yart restart` use this route. The response goes out before
  // the process stops.
  app.post('/api/shutdown', (context) => {
    if (shutdown === undefined) {
      return context.json<ErrorBody>({ error: 'This daemon cannot stop on request.' }, 404)
    }
    setImmediate(shutdown)
    return context.json({ ok: true })
  })

  app.get('/api/reviews', async (context) => {
    const archived = context.req.query('archived') === 'true'
    const lists = await Promise.all(
      (await repositories.all()).map((service) => service.list({ archived })),
    )
    // The newest first, across all repositories, as each list already is.
    return context.json(lists.flat().sort((a, b) => b.created_at.localeCompare(a.created_at)))
  })

  app.patch('/api/reviews/:id', async (context) => {
    requirePerson(context)
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
    // A line break in a title would start a new line in the text that an agent reads.
    if (
      body.title !== undefined &&
      (typeof body.title !== 'string' || hasControlCharacters(body.title))
    ) {
      throw new ReviewError('title must be one line, with no control characters', 400)
    }
    const { service, repo_root } = await repositories.resolve(body.repo_path)
    // The default is uncommitted work against HEAD. An agent that just finished
    // its edits wants this, and cannot give it as a revision range.
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
    requirePerson(context)
    const service = await repositories.locate(context.req.param('id'))
    await service.remove(context.req.param('id'))
    return context.body(null, 204)
  })

  /**
   * The two sides of a file, to show them. The path comes as a query parameter,
   * not as a path segment. Thus nested paths do not need an encoding.
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

  /** The hunks of each file. git makes them, thus the display agrees with the anchors. */
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
      author?: unknown
      author_name?: unknown
      attachments?: unknown
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
      attachments: parseAttachmentIds(body.attachments),
      ...parseSpeaker(body, context.get('role')),
    })
    return context.json(review, 201)
  })

  app.post('/api/reviews/:id/threads/:thread_id/comments', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{
      body?: string
      author?: unknown
      author_name?: unknown
      attachments?: unknown
    }>()
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      throw new ReviewError('A comment body is required', 400)
    }

    return context.json(
      await service.addComment(context.req.param('id'), context.req.param('thread_id'), body.body, {
        ...parseSpeaker(body, context.get('role')),
        attachments: parseAttachmentIds(body.attachments),
      }),
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

  /** A reply to a verdict. A verdict, unlike a line comment, has no thread. */
  app.post('/api/reviews/:id/submissions/:submission_id/comments', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{
      body?: string
      author?: unknown
      author_name?: unknown
      attachments?: unknown
    }>()
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      throw new ReviewError('A comment body is required', 400)
    }

    return context.json(
      await service.addSubmissionComment(
        context.req.param('id'),
        context.req.param('submission_id'),
        body.body,
        {
          ...parseSpeaker(body, context.get('role')),
          attachments: parseAttachmentIds(body.attachments),
        },
      ),
      201,
    )
  })

  app.post('/api/reviews/:id/submit', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    // A type annotation, not an assertion. A submission without a body is
    // correct. Thus the empty object must widen to the parameter type with no cast.
    const body: SubmitBody = await context.req.json<SubmitBody>().catch(() => ({}))

    if (body.verdict !== undefined && !VERDICTS.has(body.verdict)) {
      throw new ReviewError('Verdict must be "commented", "approved" or "changes_requested"', 400)
    }

    if (body.expected_head_sha !== undefined && typeof body.expected_head_sha !== 'string') {
      throw new ReviewError('expected_head_sha must be a string', 400)
    }

    const speaker = parseSpeaker(body, context.get('role'), SUBMITTERS)
    // The daemon examines the round limit. It does not leave it to the reviewer,
    // because the reviewer is one of the two parties that possibly do not want to stop.
    const { ai_review_rounds } = await settings.read()
    const review = await service.submit(context.req.param('id'), {
      reviewer_round_limit: ai_review_rounds,
      verdict: body.verdict,
      author: speaker.author as SubmissionAuthor,
      author_name: speaker.author_name,
      body: body.body,
      attachments: parseAttachmentIds(body.attachments),
      ...parseDrafts(body),
      expected_head_sha: body.expected_head_sha,
    })
    // Only the approval of the person completes a review. The approval of an AI
    // reviewer gives the review to the person. Thus the daemon must not archive or
    // delete it before the person looks.
    const latest = latestSubmission(review)
    if (latest?.verdict === 'approved' && submissionAuthor(latest) === 'human') {
      settleApproval(review.id, latest.id)
    }
    return context.json(review)
  })

  /**
   * Keeps an image for the comments of a review. The image comes as base64 in
   * JSON, because each write must be JSON. The daemon tells the type from the
   * bytes, not from the request.
   */
  app.post('/api/reviews/:id/attachments', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{ data?: unknown }>()
    if (typeof body.data !== 'string') throw new ReviewError('data must be a base64 image', 400)
    const attachment = await service.addAttachment(
      context.req.param('id'),
      Buffer.from(body.data, 'base64'),
    )
    return context.json(attachment, 201)
  })

  app.get('/api/reviews/:id/attachments/:attachment_id', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const found = await service.readAttachment(
      context.req.param('id'),
      context.req.param('attachment_id'),
    )
    if (found === null) throw new ReviewError('This review has no such image', 404)
    // The id is the hash of the bytes. Thus the same id always gives the same image.
    return context.body(new Uint8Array(found.data), 200, {
      'content-type': found.media_type,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
  })

  app.get('/api/settings', async (context) => context.json(await settings.read()))

  app.patch('/api/settings', async (context) => {
    requirePerson(context)
    const body = await context.req.json<unknown>().catch(() => null)
    if (typeof body !== 'object' || body === null) {
      throw new ReviewError('Settings must be sent as an object', 400)
    }
    return context.json(await settings.update(body as Record<string, unknown>))
  })

  app.post('/api/reviews/:id/advance', async (context) => {
    const service = await repositories.locate(context.req.param('id'))
    const body = await context.req.json<{ head?: string }>().catch(() => ({ head: undefined }))
    return context.json(await service.advanceHead(context.req.param('id'), body.head))
  })

  /**
   * The web UI. It is last, thus each API route wins.
   *
   * For an unknown path, the daemon sends index.html, not a 404. The UI does its
   * routes in the browser. A link such as /reviews/<id> is a real page there,
   * but it is not a file on the disk.
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
