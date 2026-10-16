import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { authorHasAnswered, type FileDiff, type ReviewVerdict, type Settings } from '@yart/core'
import {
  authHeaders,
  daemonUrl,
  defaultStateDir,
  foreignMessage,
  probeDaemon,
  uiUrl,
  type Review,
} from '@yart/daemon'

export const DEFAULT_PORT = 7777

/** How long to wait until a daemon that we started answers its health check. */
const STARTUP_TIMEOUT_MS = 10_000
const STARTUP_POLL_MS = 150

export class DaemonError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'DaemonError'
    this.status = status
  }
}

export interface DaemonClientOptions {
  port?: number
  /** The repository of this client, or null for none, as in the desktop app. */
  repo_path?: string | null
  /** Start a daemon when no daemon listens. It is on by default, thus the first call of the agent works. */
  autostart?: boolean
  /**
   * The entry point of the daemon to start. The default is the entry point of
   * this workspace. A packaged app does not have it, thus it gives the bundled
   * entry point.
   */
  daemon_cli?: string
  /** Where the token file of the daemon is. The default is the home of yart. */
  state_dir?: string
}

const resolveDaemonCli = (): string => {
  const requireFromHere = createRequire(import.meta.url)
  return requireFromHere.resolve('@yart/daemon/cli')
}

/** One round of an AI reviewer: its verdict and what it says with it. */
/** The largest image that the daemon accepts, in bytes. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface ReviewerRound {
  verdict: ReviewVerdict
  summary?: string
  /** The ids of the images of the summary. */
  attachments?: string[]
  comments?: {
    path: string
    line: number
    side?: 'base' | 'head'
    body: string
    attachments?: string[]
  }[]
  replies?: { thread_id: string; body: string; attachments?: string[] }[]
  reviewer_name?: string
}

export interface CreateReviewOptions {
  base?: string
  head?: string
  title?: string
  description?: string
  /** The repository or worktree to review. A relative path starts at the repository of this client. */
  repo_path?: string
}

export interface WaitOptions {
  poll_ms?: number
  /** Tells if the wait is over. */
  done?: (review: Review) => boolean
}

export class DaemonClient {
  readonly base_url: string
  private readonly port: number
  private readonly repo_path: string | null
  private readonly autostart: boolean
  private readonly daemon_cli: string | undefined
  private readonly state_dir: string
  /** The token of the daemon, after it proved that it is the daemon. Null before. */
  private token: string | null

  constructor(options: DaemonClientOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT
    this.repo_path = options.repo_path === undefined ? process.cwd() : options.repo_path
    this.autostart = options.autostart ?? true
    this.daemon_cli = options.daemon_cli
    this.state_dir = options.state_dir ?? defaultStateDir()
    this.base_url = daemonUrl(this.port)
    this.token = null
  }

  /**
   * The token of the daemon, after the process on the port proves that it is
   * the daemon. Refuses a different process. Null when no process answers.
   */
  private async connect(): Promise<string | null> {
    const probe = await probeDaemon(this.port, this.state_dir)
    if (probe.state === 'foreign') throw new DaemonError(foreignMessage(this.port), null)
    return probe.state === 'yart' ? probe.token : null
  }

  /**
   * Makes sure that a daemon listens. It starts one if no daemon listens.
   *
   * The child process is detached, and its stdio goes nowhere. Thus the review
   * continues after this process stops. An MCP server stops with its client, and
   * a review must continue after that. A daemon that already runs is used again,
   * whoever started it.
   */
  async ensureRunning(): Promise<string> {
    if (this.token !== null) return this.token
    this.token = await this.connect()
    if (this.token !== null) return this.token
    if (!this.autostart) {
      throw new DaemonError(
        `No yart daemon answers on ${this.base_url}. Start one with \`yart\`.`,
        null,
      )
    }

    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        this.daemon_cli ?? resolveDaemonCli(),
        ...(this.repo_path === null ? [] : ['--repo', this.repo_path]),
        '--port',
        String(this.port),
      ],
      {
        detached: true,
        stdio: 'ignore',
        // In the desktop app, this process is Electron. Electron runs as plain
        // Node only when this variable tells it to. All other processes ignore it.
        // eslint-disable-next-line @typescript-eslint/naming-convention -- an environment variable
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    )
    child.unref()

    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      await delay(STARTUP_POLL_MS)
      this.token = await this.connect()
      if (this.token !== null) return this.token
    }
    throw new DaemonError(`The yart daemon did not start in ${STARTUP_TIMEOUT_MS} ms.`, null)
  }

  /**
   * Sends a request with the token. The daemon makes a new token when it starts
   * again. Thus a refused token makes the client prove the daemon again, one time.
   */
  private async send(path: string, init?: RequestInit): Promise<Response> {
    const attempt = async () =>
      fetch(`${this.base_url}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...init?.headers,
          ...authHeaders(await this.ensureRunning()),
        },
      })
    const response = await attempt()
    if (response.status !== 401) return response
    this.token = null
    return attempt()
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.send(path, init)

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new DaemonError(
        body?.error ?? `The request to the yart daemon failed with status ${response.status}.`,
        response.status,
      )
    }
    return (await response.json()) as T
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  /** An image of a review, as base64. */
  async getAttachment(review_id: string, attachment_id: string): Promise<string> {
    const response = await this.send(
      `/api/reviews/${encodeURIComponent(review_id)}/attachments/${encodeURIComponent(attachment_id)}`,
    )
    if (!response.ok) {
      throw new DaemonError(`The yart daemon has no image ${attachment_id}.`, response.status)
    }
    return Buffer.from(await response.arrayBuffer()).toString('base64')
  }

  /** The page of a review, on the name of the web UI. */
  reviewUrl(review_id: string): string {
    return `${uiUrl(this.port)}/reviews/${review_id}`
  }

  /**
   * A one-time link that signs the window of the person in, and then opens a
   * page. The link has the origin of the page, because a development UI has a
   * different origin than the daemon. Only the window of the person can give a
   * verdict as the person. Do not give this link to an agent.
   */
  async signInUrl(url: string): Promise<string> {
    const { code } = await this.post<{ code: string }>('/api/sign-in-codes', {})
    const page = new URL(url)
    const next = `${page.pathname}${page.search}`
    return new URL(`/sign-in?code=${code}&next=${encodeURIComponent(next)}`, page).href
  }

  listReviews(): Promise<Review[]> {
    return this.request<Review[]>('/api/reviews')
  }

  getReview(review_id: string): Promise<Review> {
    return this.request<Review>(`/api/reviews/${encodeURIComponent(review_id)}`)
  }

  /**
   * Opens a review. The default repository is the directory where this server
   * started. A client can start the server in a different directory than the
   * agent works in, for example the main checkout for an agent in a worktree.
   * Then the agent gives `repo_path`.
   */
  createReview({ repo_path, ...params }: CreateReviewOptions = {}): Promise<Review> {
    // Each request names the repository. One daemon serves all repositories, and
    // only this tells it which repository the agent works in.
    const repository =
      repo_path === undefined ? this.repo_path : resolve(this.repo_path ?? process.cwd(), repo_path)
    return this.post<Review>('/api/reviews', { ...params, repo_path: repository })
  }

  advanceReview(review_id: string, head?: string, description?: string): Promise<Review> {
    return this.post<Review>(`/api/reviews/${encodeURIComponent(review_id)}/advance`, {
      head,
      description,
    })
  }

  /**
   * Sends image files from the disk to a review, and returns their ids. A
   * relative path starts at the repository of the agent.
   */
  async uploadImages(
    review_id: string,
    paths: readonly string[] | undefined,
  ): Promise<string[] | undefined> {
    if (paths === undefined || paths.length === 0) return undefined
    const ids: string[] = []
    // The repository of the review, which can be a worktree, not the start directory.
    const { repo_path } = await this.getReview(review_id)
    for (const path of paths) {
      const full = resolve(repo_path, path)
      const size = (await stat(full).catch(() => null))?.size
      if (size === undefined) throw new DaemonError(`No file at ${full}.`, null)
      if (size > MAX_IMAGE_BYTES) {
        throw new DaemonError(`${full} is larger than 5 MB. Use a smaller image.`, null)
      }
      const data = (await readFile(full)).toString('base64')
      const { id } = await this.post<{ id: string }>(
        `/api/reviews/${encodeURIComponent(review_id)}/attachments`,
        { data },
      )
      ids.push(id)
    }
    return ids
  }

  replyToThread(
    review_id: string,
    thread_id: string,
    body: string,
    attachments?: string[],
  ): Promise<Review> {
    return this.post<Review>(
      `/api/reviews/${encodeURIComponent(review_id)}/threads/${encodeURIComponent(thread_id)}/comments`,
      { body, author: 'agent', attachments },
    )
  }

  replyToVerdict(
    review_id: string,
    submission_id: string,
    body: string,
    attachments?: string[],
  ): Promise<Review> {
    return this.post<Review>(
      `/api/reviews/${encodeURIComponent(review_id)}/submissions/${encodeURIComponent(submission_id)}/comments`,
      { body, author: 'agent', attachments },
    )
  }

  /** The diff of a review. With `since`, the head of an earlier round, only the changes after it. */
  getDiff(review_id: string, since?: string): Promise<FileDiff[]> {
    const query = since === undefined ? '' : `?since=${encodeURIComponent(since)}`
    return this.request<FileDiff[]>(`/api/reviews/${encodeURIComponent(review_id)}/diff${query}`)
  }

  getSettings(): Promise<Settings> {
    return this.request<Settings>('/api/settings')
  }

  /** Gives a verdict as an AI reviewer, with the comments and replies of its round. */
  submitAsReviewer(review_id: string, round: ReviewerRound): Promise<Review> {
    return this.post<Review>(`/api/reviews/${encodeURIComponent(review_id)}/submit`, {
      verdict: round.verdict,
      body: round.summary,
      attachments: round.attachments,
      threads: round.comments,
      replies: round.replies,
      author: 'reviewer',
      author_name: round.reviewer_name,
    })
  }

  setThreadStatus(
    review_id: string,
    thread_id: string,
    status: 'open' | 'resolved',
  ): Promise<Review> {
    return this.request<Review>(
      `/api/reviews/${encodeURIComponent(review_id)}/threads/${encodeURIComponent(thread_id)}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    )
  }

  /**
   * Polls until the author answers the verdict of a reviewer, or until the time
   * limit is over. `done` can ask for more than an answer.
   *
   * It polls, and does not keep a connection open. The daemon keeps no state
   * about who waits. A lost poll costs one second, not a lost signal.
   */
  async waitForAuthor(
    review_id: string,
    timeout_ms: number,
    { poll_ms = 1000, done = authorHasAnswered }: WaitOptions = {},
  ): Promise<Review | null> {
    const deadline = Date.now() + timeout_ms
    for (;;) {
      const review = await this.getReview(review_id)
      if (done(review)) return review
      if (Date.now() >= deadline) return null
      await delay(Math.min(poll_ms, Math.max(0, deadline - Date.now())))
    }
  }

  async waitForSubmission(
    review_id: string,
    timeout_ms: number,
    poll_ms = 1000,
  ): Promise<Review | null> {
    const deadline = Date.now() + timeout_ms
    for (;;) {
      const review = await this.getReview(review_id)
      if (review.status === 'submitted') return review
      if (Date.now() >= deadline) return null
      await delay(Math.min(poll_ms, Math.max(0, deadline - Date.now())))
    }
  }
}
