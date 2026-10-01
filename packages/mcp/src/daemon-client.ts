import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
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

/** What `/health` answers. `version` is absent from a daemon older than it. */
interface DaemonHealth {
  ok: boolean
  repo_path?: string
  version?: string
  code_dir?: string
}

export interface DaemonClientOptions {
  port?: number
  /** The repository this client works in; null for none, as in the desktop app. */
  repo_path?: string | null
  /** Start a daemon when none is listening. On by default, so the agent's first call works. */
  autostart?: boolean
  /**
   * The daemon entry point to start. Defaults to this workspace's, which a
   * packaged app does not have: it passes the bundled one instead.
   */
  daemon_cli?: string
}

const resolveDaemonCli = (): string => {
  const requireFromHere = createRequire(import.meta.url)
  return requireFromHere.resolve('@yart/daemon/cli')
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
   * A daemon from before `version` existed serves only the repository it was
   * started in, and ignores the one a request names — so reusing it from
   * anywhere else would review its working tree instead, without a word. That
   * daemon is still running for a while after an update, which is exactly when
   * this matters. One started in this same repository is fine to keep using.
   */
  private checkServes(health: DaemonHealth): void {
    if (health.version !== undefined || health.repo_path === undefined) return
    const mine = this.repo_path === null ? null : realpathSync(this.repo_path)
    const inside =
      mine !== null && (mine === health.repo_path || mine.startsWith(health.repo_path + sep))
    if (inside) return
    throw new DaemonError(
      `The yart daemon on port ${this.port} is from an older yart and only serves ` +
        `${health.repo_path}, so it would review that instead of ${mine ?? 'the others'}. Stop the process ` +
        `listening on port ${this.port}; the next request starts a daemon that serves every ` +
        'repository.',
      null,
    )
  }

  /**
   * Makes sure a daemon is listening, starting one if not.
   *
   * The child is detached and its stdio discarded so the review outlives this
   * process: an MCP server dies with its client, and a review has to survive
   * that. An already-running daemon is reused, whoever started it.
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
      throw new DaemonError(`No yart daemon on ${this.base_url}. Start one with \`yart\`.`, null)
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
        // Inside the desktop app this process is Electron, which runs as plain
        // Node only when told to; anywhere else the variable is ignored.
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
    // Named on every request: one daemon serves every repository, and this is
    // the only thing that tells it which one the agent is working in.
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
