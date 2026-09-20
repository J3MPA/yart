#!/usr/bin/env node
/**
 * Runs the dev environment against this repository's own current diff.
 *
 * Reviewing a fixture repo only ever exercises the shapes the fixture happens
 * to have. Pointing yart at whatever branch you are on means every run is a
 * real diff, with real renames, deletions and long files.
 *
 * Re-running on the same branch advances the existing review rather than making
 * a new one, so comments left last time follow your new commits — which is the
 * behaviour most worth having under your nose while developing.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFileAsync = promisify(execFile)

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DAEMON_CLI = fileURLToPath(new URL('../packages/daemon/src/cli.ts', import.meta.url))
const DAEMON_PORT = 7777
const VITE_PORT = 5173
const STARTUP_TIMEOUT_MS = 20_000

interface Review {
  id: string
  base_sha: string
  head_sha: string
  threads: unknown[]
  rounds: string[]
}

const git = async (...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  return stdout.trim()
}

/**
 * The commit this branch diverged from its trunk.
 *
 * A merge base rather than the trunk's tip, so the review shows what this
 * branch did and not whatever else has landed on main meanwhile.
 */
const resolveBase = async (): Promise<string> => {
  const explicit = process.argv[2]
  if (explicit !== undefined && !explicit.startsWith('-')) return explicit

  for (const trunk of ['main', 'master']) {
    try {
      const merge_base = await git('merge-base', trunk, 'HEAD')
      const head = await git('rev-parse', 'HEAD')
      // On the trunk itself there is nothing to review, so show the last commit.
      if (merge_base === head) return await git('rev-parse', 'HEAD~1')
      return merge_base
    } catch {
      continue
    }
  }
  return git('rev-parse', 'HEAD~1')
}

const isUp = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

const waitForPort = async (url: string, what: string): Promise<void> => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await delay(200)
  }
  throw new Error(`${what} did not start within ${STARTUP_TIMEOUT_MS / 1000}s`)
}

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`http://localhost:${DAEMON_PORT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `${path} failed with ${response.status}`)
  }
  return (await response.json()) as T
}

/** Reuses a review over the same base, advancing it when HEAD has moved. */
const openOrAdvanceReview = async (base_sha: string, head_sha: string): Promise<Review> => {
  const existing = (await api<Review[]>('/api/reviews')).find(
    (review) => review.base_sha === base_sha,
  )

  if (existing === undefined) {
    return api<Review>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ base: base_sha, head: 'HEAD' }),
    })
  }

  if (existing.head_sha === head_sha) return existing

  return api<Review>(`/api/reviews/${existing.id}/advance`, {
    method: 'POST',
    body: JSON.stringify({ head: 'HEAD' }),
  })
}

const children: ChildProcess[] = []

const start = (command: string, args: string[], label: string): ChildProcess => {
  const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (chunk: Buffer) =>
    process.stdout.write(`[${label}] ${chunk.toString()}`),
  )
  child.stderr?.on('data', (chunk: Buffer) =>
    process.stderr.write(`[${label}] ${chunk.toString()}`),
  )
  children.push(child)
  return child
}

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM')
}

const main = async (): Promise<void> => {
  const base_sha = await resolveBase()
  const head_sha = await git('rev-parse', 'HEAD')
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')

  // Reuse a daemon that is already listening. Spawning blindly would crash the
  // child with EADDRINUSE while the old one kept answering, leaving this script
  // reporting success against a daemon it does not own and cannot stop.
  const health_url = `http://localhost:${DAEMON_PORT}/health`
  const reused = await isUp(health_url)
  if (!reused) {
    start(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        DAEMON_CLI,
        '--repo',
        REPO_ROOT,
        '--port',
        String(DAEMON_PORT),
      ],
      'daemon',
    )
    await waitForPort(health_url, 'daemon')
  }

  const review = await openOrAdvanceReview(base_sha, head_sha)

  start('pnpm', ['--filter', '@yart/web', 'dev'], 'vite')
  await waitForPort(`http://localhost:${VITE_PORT}/`, 'vite')

  const changed = await git('diff', '--name-only', `${base_sha}..${head_sha}`)
  const file_count = changed === '' ? 0 : changed.split('\n').length

  process.stdout.write(
    [
      '',
      '  yart, reviewing itself',
      '',
      `    branch   ${branch}`,
      `    range    ${base_sha.slice(0, 8)}..${head_sha.slice(0, 8)}  (${file_count} files)`,
      `    round    ${review.rounds.length}, ${review.threads.length} thread(s) carried over`,
      `    daemon   ${reused ? 'reused one already running' : 'started'} on ${DAEMON_PORT}`,
      '',
      `    open     http://localhost:${VITE_PORT}/reviews/${review.id}`,
      '',
      '  Vite has the UI with hot reload; the daemon serves /api behind it.',
      '  Commit, re-run, and your comments follow the lines they were on.',
      '',
    ].join('\n'),
  )
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})

main().catch((cause: unknown) => {
  shutdown()
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
