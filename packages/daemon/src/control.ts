import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

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
