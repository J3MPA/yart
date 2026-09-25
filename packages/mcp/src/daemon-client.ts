import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import type { Review } from '@yart/daemon'

export const DEFAULT_PORT = 7777

/** How long to wait for a daemon we started to answer its health check. */
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
  repo_path?: string
  /** Start a daemon when none is listening. On by default, so the agent's first call works. */
  autostart?: boolean
}

const resolveDaemonCli = (): string => {
  const requireFromHere = createRequire(import.meta.url)
  return requireFromHere.resolve('@yart/daemon/cli')
}

export class DaemonClient {
  readonly base_url: string
  private readonly port: number
  private readonly repo_path: string
  private readonly autostart: boolean
  private started: boolean

  constructor(options: DaemonClientOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT
    this.repo_path = options.repo_path ?? process.cwd()
    this.autostart = options.autostart ?? true
    this.base_url = `http://localhost:${this.port}`
    this.started = false
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.base_url}/health`)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Makes sure a daemon is listening, starting one if not.
   *
   * The child is detached and its stdio discarded so the review outlives this
   * process: an MCP server dies with its client, and a review has to survive
   * that. An already-running daemon is reused, whoever started it.
   */
  async ensureRunning(): Promise<void> {
    if (this.started || (await this.isHealthy())) {
      this.started = true
      return
    }
    if (!this.autostart) {
      throw new DaemonError(`No yart daemon on ${this.base_url}. Start one with \`yart\`.`, null)
    }

    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        resolveDaemonCli(),
        '--repo',
        this.repo_path,
        '--port',
        String(this.port),
      ],
      { detached: true, stdio: 'ignore' },
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
    throw new DaemonError(`Daemon did not become healthy within ${STARTUP_TIMEOUT_MS}ms`, null)
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    await this.ensureRunning()

    const response = await fetch(`${this.base_url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new DaemonError(body?.error ?? `Request failed: ${response.status}`, response.status)
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
    return this.post<Review>('/api/reviews', { base, head, title })
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
   * Polls until the review is submitted or the deadline passes.
   *
   * Polling rather than a held-open connection: the daemon keeps no waiter
   * state, and a dropped poll costs one second rather than a lost wakeup.
   */
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
