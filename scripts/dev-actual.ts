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
 *
 * With `--desktop` it opens the review in the Electron shell instead of printing
 * a URL for the browser, and quitting the shell ends the session.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFileAsync = promisify(execFile)

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DAEMON_CLI = fileURLToPath(new URL('../packages/daemon/src/cli.ts', import.meta.url))
const DAEMON_CODE_DIR = fileURLToPath(new URL('../packages/daemon/', import.meta.url))
// Not 7777: that is where an installed yart listens, serving its own code.
const DAEMON_PORT = 7778
const VITE_PORT = 5173
const STARTUP_TIMEOUT_MS = 20_000

const ARGS = process.argv.slice(2)
const DESKTOP = ARGS.includes('--desktop')

interface Review {
  id: string
  repo_path: string
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
  const explicit = ARGS.find((arg) => !arg.startsWith('-'))
  if (explicit !== undefined) return explicit

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

interface Health {
  code_dir?: string
}

const health = async (url: string): Promise<Health | null> => {
  try {
    const response = await fetch(url)
    return response.ok ? ((await response.json()) as Health) : null
  } catch {
    return null
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
  // The daemon serves every repository, so both the lookup and the new review
  // have to say this one: a reused daemon may have been started anywhere. Asked
  // of git rather than taken from REPO_ROOT, which ends in a slash and would
  // never equal the path the daemon records.
  const repo_path = await git('rev-parse', '--show-toplevel')
  const existing = (await api<Review[]>('/api/reviews')).find(
    (review) => review.repo_path === repo_path && review.base_sha === base_sha,
  )

  if (existing === undefined) {
    return api<Review>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ base: base_sha, head: 'HEAD', repo_path }),
    })
  }

  if (existing.head_sha === head_sha) return existing

  return api<Review>(`/api/reviews/${existing.id}/advance`, {
    method: 'POST',
    body: JSON.stringify({ head: 'HEAD' }),
  })
}

const children: ChildProcess[] = []

const start = (
  command: string,
  args: string[],
  label: string,
  env: Record<string, string> = {},
): ChildProcess => {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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

  // Reuse a daemon that is already listening, but only one running this
  // checkout's code: another checkout's would serve changes other than the ones
  // being worked on. Spawning blindly would crash the child with EADDRINUSE
  // while the old one kept answering, leaving this script reporting success
  // against a daemon it does not own and cannot stop.
  const health_url = `http://localhost:${DAEMON_PORT}/health`
  const found = await health(health_url)
  if (found !== null && found.code_dir !== DAEMON_CODE_DIR) {
    throw new Error(
      `Port ${DAEMON_PORT} is taken by a yart daemon from ` +
        `${found.code_dir ?? 'an older checkout'}, not this one. Stop it and re-run.`,
    )
  }
  const reused = found !== null
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

  // A strict port, so a Vite already running for another checkout is an error
  // rather than this one quietly moving to the next port while the address
  // printed below points at the other.
  start('pnpm', ['--filter', '@yart/web', 'dev', '--strictPort'], 'vite', {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- an environment variable
    YART_DAEMON_PORT: String(DAEMON_PORT),
  })
  await waitForPort(`http://localhost:${VITE_PORT}/`, 'vite')

  const review_url = `http://localhost:${VITE_PORT}/reviews/${review.id}`
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
      DESKTOP ? '    open     in the desktop shell' : `    open     ${review_url}`,
      '',
      '  Vite has the UI with hot reload; the daemon serves /api behind it.',
      '  Commit, re-run, and your comments follow the lines they were on.',
      '',
    ].join('\n'),
  )

  if (DESKTOP) {
    const desktop = start('pnpm', ['--filter', '@yart/desktop', 'start'], 'desktop', {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- an environment variable
      YART_DEV: '1',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- an environment variable
      YART_START_URL: review_url,
    })
    desktop.on('exit', () => {
      shutdown()
      process.exit(0)
    })
  }
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
