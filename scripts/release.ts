#!/usr/bin/env node
/**
 * Publishes a release of yart: `pnpm release <version>`.
 *
 * A `v*` tag starts `.github/workflows/release.yml`, which tests, packages and
 * publishes the app. This script makes the tag only when the release can work:
 *
 * 1. The head of `origin/main` passed the `gate` check.
 * 2. The tag does not exist yet.
 * 3. For a pre-release, the install commands in the README use the URL of the
 *    tag, because "latest" on GitHub ignores pre-releases.
 * 4. The tests pass on this Mac. The `gate` check runs on Linux, and the release
 *    job runs the tests on macOS. A test can pass on one and fail on the other.
 *
 * Then it asks, pushes the tag, and waits for the release workflow.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/
const RELEASE_WORKFLOW = 'release.yml'
/** How long to look for the run that the tag starts. GitHub needs some seconds. */
const RUN_SEARCH_MS = 60_000

const fail = (message: string): never => {
  process.stderr.write(`release: ${message}\n`)
  process.exit(1)
}

const say = (message: string) => process.stdout.write(`${message}\n`)

const run = async (command: string, args: readonly string[], cwd = REPO_ROOT) => {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Node's option name
  const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return stdout.trim()
}

/** Runs a command with its output on the terminal. Resolves its exit code. */
const runVisible = (command: string, args: readonly string[], cwd: string) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })

const gatePassed = async (sha: string): Promise<boolean> => {
  const conclusions = await run('gh', [
    'api',
    `repos/{owner}/{repo}/commits/${sha}/check-runs`,
    '--jq',
    '[.check_runs[] | select(.name == "gate") | .conclusion] | join(" ")',
  ])
  return conclusions.split(' ').includes('success')
}

const tagExists = async (tag: string): Promise<boolean> => {
  const local = await run('git', ['tag', '--list', tag])
  const remote = await run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  return local !== '' || remote !== ''
}

/** Runs the tests of the release job on a clean copy of the commit. */
const testOnThisMac = async (sha: string): Promise<boolean> => {
  const dir = await mkdtemp(join(tmpdir(), 'yart-release-'))
  const copy = join(dir, 'yart')
  try {
    await run('git', ['worktree', 'add', '--detach', copy, sha])
    const installed = await runVisible('pnpm', ['install', '--frozen-lockfile'], copy)
    return installed === 0 && (await runVisible('pnpm', ['test'], copy)) === 0
  } finally {
    await run('git', ['worktree', 'remove', '--force', copy]).catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  }
}

const confirm = async (question: string): Promise<boolean> => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question(`${question} [y/N] `)
  prompt.close()
  return answer.trim().toLowerCase() === 'y'
}

/** The id of the run of the release workflow for the tag, or null when it does not start. */
const findReleaseRun = async (tag: string): Promise<string | null> => {
  const stop_at = Date.now() + RUN_SEARCH_MS
  while (Date.now() < stop_at) {
    const id = await run('gh', [
      'run',
      'list',
      '--workflow',
      RELEASE_WORKFLOW,
      '--branch',
      tag,
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--jq',
      '.[0].databaseId // ""',
    ])
    if (id !== '') return id
    await delay(3000)
  }
  return null
}

const main = async () => {
  if (process.platform !== 'darwin') fail('run this on macOS. The release job tests on macOS.')

  const version = (process.argv[2] ?? '').replace(/^v/, '')
  if (!VERSION.test(version)) fail('give a version, for example: pnpm release 0.1.0-beta.7')
  const tag = `v${version}`
  const pre_release = version.includes('-')

  await run('git', ['fetch', '--quiet', '--tags', 'origin', 'main'])
  const sha = await run('git', ['rev-parse', 'origin/main'])
  const subject = await run('git', ['log', '-1', '--format=%s', sha])
  say(`Release ${tag} from ${sha.slice(0, 7)}: ${subject}`)

  if (await tagExists(tag)) fail(`the tag ${tag} exists already.`)
  if (!(await gatePassed(sha))) fail(`the gate check did not pass on ${sha.slice(0, 7)}.`)

  if (pre_release) {
    const readme = await run('git', ['show', `${sha}:README.md`])
    if (!readme.includes(`/releases/download/${tag}/install.sh`)) {
      fail(
        `the install commands in README.md do not use ${tag}. "latest" on GitHub ignores ` +
          'pre-releases. Change them in a PR first.',
      )
    }
  }

  say('Running the tests on this Mac. The release job runs them on macOS.')
  if (!(await testOnThisMac(sha))) fail('the tests failed on this Mac.')

  if (!(await confirm(`Push the tag ${tag}? This publishes the release.`))) fail('stopped.')
  await run('git', ['tag', tag, sha])
  await run('git', ['push', 'origin', tag])
  say(`Pushed ${tag}.`)

  const run_id = await findReleaseRun(tag)
  if (run_id === null) fail('the release workflow did not start. Look at the Actions tab.')
  const watched = await runVisible(
    'gh',
    ['run', 'watch', run_id as string, '--exit-status', '--interval', '30'],
    REPO_ROOT,
  )
  if (watched !== 0) {
    fail(
      `the release workflow failed. Nothing is published. To try again with the same tag, ` +
        `remove it first: git push origin :refs/tags/${tag} && git tag -d ${tag}`,
    )
  }
  say(await run('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url']))
}

await main()
