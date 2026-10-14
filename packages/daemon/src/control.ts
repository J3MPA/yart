import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import type { Review } from '@yart/core'

export interface DaemonHealth {
  repo_path: string | null
  version?: string
  code_dir?: string
}

/** The health of the daemon on a port, or null when no daemon answers. */
export const daemonHealth = async (port: number): Promise<DaemonHealth | null> => {
  try {
    const response = await fetch(`http://localhost:${port}/health`)
    return response.ok ? ((await response.json()) as DaemonHealth) : null
  } catch {
    return null
  }
}

const waitFor = async (check: () => Promise<boolean>, timeout_ms: number): Promise<boolean> => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await delay(100)
  }
  return false
}

/**
 * Stops the daemon on a port, and waits until it does not answer. Returns false
 * when no daemon ran.
 */
export const stopDaemon = async (port: number, timeout_ms = 5000): Promise<boolean> => {
  if ((await daemonHealth(port)) === null) return false
  const response = await fetch(`http://localhost:${port}/api/shutdown`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null)
  if (response?.status === 404) {
    throw new Error(
      `The daemon on port ${port} cannot stop on request, because it is from an older yart. ` +
        `Stop its process: lsof -ti tcp:${port} | xargs kill`,
    )
  }
  const stopped = await waitFor(async () => (await daemonHealth(port)) === null, timeout_ms)
  if (!stopped) throw new Error(`The daemon on port ${port} did not stop.`)
  return true
}

export interface StartOptions {
  port: number
  repo_path: string | null
  /** The CLI of the daemon. The child runs it with the same Node and flags as this process. */
  cli_path: string
  timeout_ms?: number
}

/**
 * Starts a daemon in the background, and waits until it answers. No terminal
 * owns the child. In the desktop app, this process is Electron in the mode of
 * Node, and the child gets that mode from the environment.
 */
export const startDaemon = async (options: StartOptions): Promise<void> => {
  const { port, repo_path, cli_path, timeout_ms = 10_000 } = options
  spawn(
    process.execPath,
    [
      ...process.execArgv,
      cli_path,
      '--port',
      String(port),
      ...(repo_path === null ? [] : ['--repo', repo_path]),
    ],
    { detached: true, stdio: 'ignore' },
  ).unref()
  const started = await waitFor(async () => (await daemonHealth(port)) !== null, timeout_ms)
  if (!started) throw new Error(`The daemon did not start on port ${port}.`)
}

export interface WaitOptions {
  port: number
  review_id: string
  /** Null waits with no limit. */
  timeout_ms: number | null
  /** Tells if the wait is over. The default waits for a verdict, as `await_review` does. */
  done?: (review: Review) => boolean
  poll_ms?: number
}

/**
 * Waits until a review is in the state that `done` asks for. Returns the
 * review, or null when the time is over. A daemon that does not answer for a
 * short time, for example during a restart, does not stop the wait.
 */
export const waitForReview = async (options: WaitOptions): Promise<Review | null> => {
  const {
    port,
    review_id,
    timeout_ms,
    done = (review) => review.status === 'submitted',
    poll_ms = 1000,
  } = options
  const deadline = timeout_ms === null ? null : Date.now() + timeout_ms
  for (;;) {
    const response = await fetch(
      `http://localhost:${port}/api/reviews/${encodeURIComponent(review_id)}`,
    ).catch(() => null)
    if (response?.status === 404) throw new Error(`There is no review ${review_id}.`)
    if (response?.ok === true) {
      const review = (await response.json()) as Review
      if (done(review)) return review
    }
    if (deadline !== null && Date.now() >= deadline) return null
    await delay(poll_ms)
  }
}
