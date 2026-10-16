import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import type { Review } from '@yart/core'
import { daemonUrl, uiUrl } from './auth.ts'
import { authHeaders, foreignMessage, probeDaemon, type Probe } from './probe.ts'

export type { DaemonHealth } from './probe.ts'

/**
 * What answers on a port. Use it for each request: the token changes when the
 * daemon starts again.
 */
export const daemonHealth = (port: number, state_dir: string): Promise<Probe> =>
  probeDaemon(port, state_dir)

/** The token of the daemon on a port. Refuses a process that is not the daemon. */
const verifiedToken = async (port: number, state_dir: string): Promise<string | null> => {
  const probe = await probeDaemon(port, state_dir)
  if (probe.state === 'foreign') throw new Error(foreignMessage(port))
  return probe.state === 'yart' ? probe.token : null
}

/**
 * A one-time link that signs the window of the person in to the daemon, and
 * opens a page.
 */
export const signInUrl = async (port: number, state_dir: string, path = '/'): Promise<string> => {
  const token = await verifiedToken(port, state_dir)
  if (token === null) throw new Error(`No yart daemon runs on port ${port}.`)
  const response = await fetch(`${daemonUrl(port)}/api/sign-in-codes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: '{}',
  })
  if (!response.ok) throw new Error(`The daemon refused a sign-in link (${response.status}).`)
  const { code } = (await response.json()) as { code: string }
  return `${uiUrl(port)}/sign-in?code=${code}&next=${encodeURIComponent(path)}`
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
export const stopDaemon = async (
  port: number,
  state_dir: string,
  timeout_ms = 5000,
): Promise<boolean> => {
  const probe = await probeDaemon(port, state_dir)
  if (probe.state === 'none') return false
  // A daemon from before the token does not prove itself, but it stops on a
  // request with no token. Thus an update can stop it. A different program does
  // not stop, and the error below tells how to stop it.
  const response = await fetch(`${daemonUrl(port)}/api/shutdown`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(probe.state === 'yart' ? authHeaders(probe.token) : {}),
    },
    body: '{}',
  }).catch(() => null)
  if (response?.status === 404) {
    throw new Error(
      `The daemon on port ${port} cannot stop on request, because it is from an older yart. ` +
        `Stop its process: lsof -ti tcp:${port} | xargs kill`,
    )
  }
  const stopped = await waitFor(
    async () => (await probeDaemon(port, state_dir)).state === 'none',
    timeout_ms,
  )
  if (!stopped) {
    throw new Error(
      probe.state === 'yart' ? `The daemon on port ${port} did not stop.` : foreignMessage(port),
    )
  }
  return true
}

export interface StartOptions {
  port: number
  state_dir: string
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
  const { port, state_dir, repo_path, cli_path, timeout_ms = 10_000 } = options
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
  const started = await waitFor(
    async () => (await probeDaemon(port, state_dir)).state === 'yart',
    timeout_ms,
  )
  if (!started) throw new Error(`The daemon did not start on port ${port}.`)
}

export interface WaitOptions {
  port: number
  state_dir: string
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
    state_dir,
    review_id,
    timeout_ms,
    done = (review) => review.status === 'submitted',
    poll_ms = 1000,
  } = options
  const deadline = timeout_ms === null ? null : Date.now() + timeout_ms
  // The token changes when the daemon starts again. Thus a refused token makes
  // the next poll prove the daemon and read the token again.
  let token: string | null = null
  for (;;) {
    token ??= await verifiedToken(port, state_dir)
    const response =
      token === null
        ? null
        : await fetch(`${daemonUrl(port)}/api/reviews/${encodeURIComponent(review_id)}`, {
            headers: authHeaders(token),
          }).catch(() => null)
    if (response?.status === 401) token = null
    if (response?.status === 404) throw new Error(`There is no review ${review_id}.`)
    if (response?.ok === true) {
      const review = (await response.json()) as Review
      if (done(review)) return review
    }
    if (deadline !== null && Date.now() >= deadline) return null
    await delay(poll_ms)
  }
}
