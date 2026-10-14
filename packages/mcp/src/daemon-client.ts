import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import {
  latestSubmission,
  submissionAuthor,
  type FileDiff,
  type ReviewVerdict,
  type Settings,
} from '@yart/core'
import type { Review } from '@yart/daemon'

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

/** The answer of `/health`. A daemon that is older than `version` does not send it. */
interface DaemonHealth {
  ok: boolean
  repo_path?: string
  version?: string
  code_dir?: string
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
}

const resolveDaemonCli = (): string => {
  const requireFromHere = createRequire(import.meta.url)
  return requireFromHere.resolve('@yart/daemon/cli')
}

/** One round of an AI reviewer: its verdict and what it says with it. */
export interface ReviewerRound {
  verdict: ReviewVerdict
  summary?: string
  comments?: { path: string; line: number; side?: 'base' | 'head'; body: string }[]
  replies?: { thread_id: string; body: string }[]
  reviewer_name?: string
}

/**
 * Tells if the agent under review did something after the last verdict of an AI
 * reviewer. It can move the review to new work, or write in it. Both give the
 * turn to the reviewer. A reply alone can mean that the author disagrees, and
 * that also needs an answer.
 */
export const authorHasAnswered = (review: Review): boolean => {
  const verdict = latestSubmission(review)
  if (verdict === null || submissionAuthor(verdict) !== 'reviewer') return false
  if (review.head_sha !== verdict.head_sha) return true
  const spoken = [
    ...review.threads.flatMap((thread) => thread.comments),
    ...verdict.comments,
  ].filter((comment) => comment.author === 'agent')
  return spoken.some((comment) => comment.created_at > verdict.created_at)
}

export class DaemonClient {
  readonly base_url: string
  private readonly port: number
  private readonly repo_path: string | null
  private readonly autostart: boolean
  private readonly daemon_cli: string | undefined
  private started: boolean

  constructor(options: DaemonClientOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT
    this.repo_path = options.repo_path === undefined ? process.cwd() : options.repo_path
    this.autostart = options.autostart ?? true
    this.daemon_cli = options.daemon_cli
    this.base_url = `http://localhost:${this.port}`
    this.started = false
  }

  private async health(): Promise<DaemonHealth | null> {
    try {
      const response = await fetch(`${this.base_url}/health`)
      return response.ok ? ((await response.json()) as DaemonHealth) : null
    } catch {
      return null
    }
  }

  private async isHealthy(): Promise<boolean> {
    return (await this.health()) !== null
  }

  /**
   * Refuses a daemon that would review the wrong repository.
   *
   * A daemon from before `version` existed serves only the repository that it
   * started in. It ignores the repository that a request names. Thus from a
   * different place, it would review its own working tree, with no warning.
   * After an update, such a daemon still runs for some time, and then this check
   * is important. A daemon that started in this same repository is correct.
   */
  private checkServes(health: DaemonHealth): void {
    if (health.version !== undefined || health.repo_path === undefined) return
    const mine = this.repo_path === null ? null : realpathSync(this.repo_path)
    const inside =
      mine !== null && (mine === health.repo_path || mine.startsWith(health.repo_path + sep))
    if (inside) return
    throw new DaemonError(
      `The yart daemon on port ${this.port} is from an older yart. It serves only ` +
        `${health.repo_path}, not ${mine ?? 'the other repositories'}. Stop the process on port ` +
        `${this.port}. The next request starts a daemon that serves all repositories.`,
      null,
    )
  }

  /**
   * Makes sure that a daemon listens. It starts one if no daemon listens.
   *
   * The child process is detached, and its stdio goes nowhere. Thus the review
   * continues after this process stops. An MCP server stops with its client, and
   * a review must continue after that. A daemon that already runs is used again,
   * whoever started it.
   */
  async ensureRunning(): Promise<void> {
    if (this.started) return
    const found = await this.health()
    if (found !== null) {
      this.checkServes(found)
      this.started = true
      return
    }
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
      if (await this.isHealthy()) {
        this.started = true
        return
      }
    }
    throw new DaemonError(`The yart daemon did not start in ${STARTUP_TIMEOUT_MS} ms.`, null)
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    await this.ensureRunning()

    const response = await fetch(`${this.base_url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })

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

  reviewUrl(review_id: string): string {
    return `${this.base_url}/reviews/${review_id}`
  }

  listReviews(): Promise<Review[]> {
    return this.request<Review[]>('/api/reviews')
  }

  getReview(review_id: string): Promise<Review> {
    return this.request<Review>(`/api/reviews/${encodeURIComponent(review_id)}`)
  }

  createReview(base?: string, head?: string, title?: string): Promise<Review> {
    // Each request names the repository. One daemon serves all repositories, and
    // only this tells it which repository the agent works in.
    return this.post<Review>('/api/reviews', { base, head, title, repo_path: this.repo_path })
  }

  advanceReview(review_id: string, head?: string): Promise<Review> {
    return this.post<Review>(`/api/reviews/${encodeURIComponent(review_id)}/advance`, { head })
  }

  replyToThread(review_id: string, thread_id: string, body: string): Promise<Review> {
    return this.post<Review>(
      `/api/reviews/${encodeURIComponent(review_id)}/threads/${encodeURIComponent(thread_id)}/comments`,
      { body, author: 'agent' },
    )
  }

  replyToVerdict(review_id: string, submission_id: string, body: string): Promise<Review> {
    return this.post<Review>(
      `/api/reviews/${encodeURIComponent(review_id)}/submissions/${encodeURIComponent(submission_id)}/comments`,
      { body, author: 'agent' },
    )
  }

  getDiff(review_id: string): Promise<FileDiff[]> {
    return this.request<FileDiff[]>(`/api/reviews/${encodeURIComponent(review_id)}/diff`)
  }

  getSettings(): Promise<Settings> {
    return this.request<Settings>('/api/settings')
  }

  /** Gives a verdict as an AI reviewer, with the comments and replies of its round. */
  submitAsReviewer(review_id: string, round: ReviewerRound): Promise<Review> {
    return this.post<Review>(`/api/reviews/${encodeURIComponent(review_id)}/submit`, {
      verdict: round.verdict,
      body: round.summary,
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
   * Polls until the review has a verdict, or until the time limit is over.
   *
   * It polls, and does not keep a connection open. The daemon keeps no state
   * about who waits. A lost poll costs one second, not a lost signal.
   */
  async waitForAuthor(
    review_id: string,
    timeout_ms: number,
    poll_ms = 1000,
  ): Promise<Review | null> {
    const deadline = Date.now() + timeout_ms
    for (;;) {
      const review = await this.getReview(review_id)
      if (authorHasAnswered(review)) return review
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
