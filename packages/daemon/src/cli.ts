#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --experimental-strip-types
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { authorIsDone, latestSubmission, submissionAuthor } from '@yart/core'
import { daemonUrl, LOOPBACK, makeToken, uiUrl, writeToken } from './auth.ts'
import { daemonHealth, signInUrl, startDaemon, stopDaemon, waitForReview } from './control.ts'
import { findRepoRoot, GitError } from './git.ts'
import { installHook, preCommit, uninstallHook } from './hook.ts'
import { listenOnIpv6 } from './listen.ts'
import { installReviewerAgent, uninstallReviewerAgent } from './reviewer-agent.ts'
import { defaultStateDir } from './repositories.ts'
import { foreignMessage } from './probe.ts'
import { createServer } from './server.ts'
import { VERSION } from './version.ts'

const DEFAULT_PORT = 7777

/** Opens a URL in the browser. When that fails, the URL is still in the output. */
const openUrl = (url: string): void => {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open'
  if (command === null) return
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // The URL is in the output. The person can open it.
  }
}

/**
 * A path that `--repo` names must be a repository. Without `--repo`, the
 * repository that the daemon started in is the default. A daemon that started
 * outside a repository has no default, and each request must name its
 * repository. The desktop app starts the daemon in this way.
 */
const defaultRepo = async (named: string | undefined): Promise<string | null> => {
  if (named !== undefined) return findRepoRoot(named)
  try {
    return await findRepoRoot(process.cwd())
  } catch (cause) {
    if (cause instanceof GitError) return null
    throw cause
  }
}

const parsePort = (value: string | undefined): number => {
  const port = value === undefined ? DEFAULT_PORT : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return port
}

const HOOK_USAGE = [
  'Usage: yart hook <command> [--port <port>]',
  '',
  '  install      Add a pre-commit hook to this repository. Before each commit,',
  '               an AI reviewer reviews the staged changes.',
  '  uninstall    Remove the hook, if yart wrote it.',
  '  pre-commit   Review the staged changes now. The hook runs this.',
  '',
  'Set the reviewer command on the Settings page. Without it, the hook does',
  'nothing. git commit --no-verify skips the hook one time.',
  '',
].join('\n')

/**
 * The `yart hook` commands. They return the exit code. For `pre-commit`, git
 * continues the commit only when the code is 0.
 */
const hook = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { port: { type: 'string', short: 'p' } },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Node's option name
    allowPositionals: true,
  })
  const repo_path = await findRepoRoot(process.cwd())
  const port = parsePort(values.port ?? process.env.YART_DAEMON_PORT)
  const write = (line: string) => process.stderr.write(`${line}\n`)

  switch (positionals[0]) {
    case 'install':
      write(`yart: installed the pre-commit hook at ${await installHook(repo_path)}.`)
      write('Set the reviewer command on the Settings page, or the hook does nothing.')
      return 0
    case 'uninstall':
      write(
        (await uninstallHook(repo_path))
          ? 'yart: removed the pre-commit hook.'
          : 'yart: this repository has no pre-commit hook of yart.',
      )
      return 0
    case 'pre-commit':
      return preCommit({
        repo_path,
        port,
        state_dir: defaultStateDir(),
        write,
        // Starts this same program as a daemon, with the same Node and flags.
        // In the desktop app, this process is Electron in the mode of Node, and
        // the child gets that mode from the environment.
        startDaemon: () => {
          spawn(
            process.execPath,
            [...process.execArgv, fileURLToPath(import.meta.url), '--port', String(port)],
            { detached: true, stdio: 'ignore' },
          ).unref()
        },
      })
    default:
      write(HOOK_USAGE)
      return positionals[0] === undefined ? 0 : 1
  }
}

const REVIEWER_USAGE = [
  'Usage: yart reviewer <install|uninstall> [--user]',
  '',
  '  install      Add the yart-reviewer subagent of Claude Code to this project,',
  '               in .claude/agents. With --user, add it for all projects.',
  '  uninstall    Remove the subagent, if yart wrote it.',
  '',
].join('\n')

/** The `yart reviewer` commands. They return the exit code. */
const reviewer = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { user: { type: 'boolean' } },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Node's option name
    allowPositionals: true,
  })
  const write = (line: string) => process.stderr.write(`${line}\n`)
  const scope = values.user === true ? 'user' : { project_path: await findRepoRoot(process.cwd()) }

  switch (positionals[0]) {
    case 'install':
      write(`yart: added the yart-reviewer subagent at ${await installReviewerAgent(scope)}.`)
      write('Ask your agent for an AI review of its work before you look at it.')
      return 0
    case 'uninstall':
      write(
        (await uninstallReviewerAgent(scope))
          ? 'yart: removed the yart-reviewer subagent.'
          : 'yart: there is no yart-reviewer subagent of yart here.',
      )
      return 0
    default:
      write(REVIEWER_USAGE)
      return positionals[0] === undefined ? 0 : 1
  }
}

const CONTROL_COMMANDS: ReadonlySet<string> = new Set([
  'start',
  'stop',
  'restart',
  'status',
  'open',
])

/** `yart start`, `stop`, `restart`, `status` and `open`. They return the exit code. */
const control = async (command: string, argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { port: { type: 'string', short: 'p' }, repo: { type: 'string', short: 'r' } },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Node's option name
    allowPositionals: true,
  })
  const port = parsePort(values.port)
  const state_dir = defaultStateDir()
  const write = (line: string) => process.stdout.write(`${line}\n`)
  const health = await daemonHealth(port, state_dir)
  const start = async (repo_path: string | null) => {
    await startDaemon({ port, state_dir, repo_path, cli_path: fileURLToPath(import.meta.url) })
    write(`yart: the daemon runs on ${daemonUrl(port)}.`)
  }

  switch (command) {
    case 'status':
      if (health.state !== 'yart') {
        write(
          health.state === 'none' ? `yart: no daemon runs on port ${port}.` : foreignMessage(port),
        )
        return 1
      }
      write(`yart: the daemon runs on ${daemonUrl(port)}.`)
      write(`  version:    ${health.health.version ?? 'older than 0.1.0'}`)
      write(`  repository: ${health.health.repo_path ?? 'none'}`)
      return 0
    case 'start':
      if (health.state === 'foreign') throw new Error(foreignMessage(port))
      if (health.state === 'yart') {
        write(`yart: a daemon already runs on port ${port}.`)
        return 0
      }
      await start(await defaultRepo(values.repo))
      return 0
    case 'open': {
      if (health.state === 'foreign') throw new Error(foreignMessage(port))
      if (health.state === 'none') await start(await defaultRepo(values.repo))
      const review_id = positionals[0]
      const url = await signInUrl(
        port,
        state_dir,
        review_id === undefined ? '/' : `/reviews/${encodeURIComponent(review_id)}`,
      )
      write('yart: open this link to sign in. It works one time, for 5 minutes:')
      write(`  ${url}`)
      openUrl(url)
      return 0
    }
    case 'stop':
      write(
        (await stopDaemon(port, state_dir))
          ? 'yart: the daemon stopped.'
          : `yart: no daemon runs on port ${port}.`,
      )
      return 0
    default:
      await stopDaemon(port, state_dir)
      // The new daemon keeps the default repository of the old one.
      await start(
        values.repo === undefined
          ? health.state === 'yart'
            ? health.health.repo_path
            : null
          : await findRepoRoot(values.repo),
      )
      return 0
  }
}

/**
 * `yart await <review-id>`. It waits until the review has a verdict. With
 * `--author`, an AI reviewer waits until the author answers its verdict. An
 * agent runs it in the background, thus its turn stays free while it waits.
 * Exit code 0: the wait is over. Exit code 2: the time limit was over.
 */
const awaitVerdict = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      port: { type: 'string', short: 'p' },
      timeout: { type: 'string', short: 't' },
      author: { type: 'boolean', short: 'a' },
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Node's option name
    allowPositionals: true,
  })
  const review_id = positionals[0]
  if (review_id === undefined) {
    process.stderr.write(
      'Usage: yart await <review-id> [--author] [--port <port>] [--timeout <minutes>]\n',
    )
    return 1
  }
  const minutes = values.timeout === undefined ? null : Number(values.timeout)
  if (minutes !== null && !(minutes > 0)) throw new Error(`Invalid timeout: ${values.timeout}`)

  const port = parsePort(values.port)
  const state_dir = defaultStateDir()
  const timeout_ms = minutes === null ? null : minutes * 60_000

  if (values.author === true) {
    const current = await waitForReview({
      port,
      state_dir,
      review_id,
      timeout_ms: 0,
      done: () => true,
    })
    const verdict = current === null ? null : latestSubmission(current)
    if (verdict === null || submissionAuthor(verdict) !== 'reviewer') {
      throw new Error(
        `No AI reviewer gave a verdict on ${review_id}. Give one with submit_verdict.`,
      )
    }
    const answered = await waitForReview({
      port,
      state_dir,
      review_id,
      timeout_ms,
      done: (review) => authorIsDone(review),
    })
    if (answered === null) {
      process.stdout.write(
        `yart: the author did not answer on ${review_id} in ${minutes} minutes.\n`,
      )
      return 2
    }
    process.stdout.write(
      answered.head_sha === verdict.head_sha
        ? `yart: the author answered on ${review_id}, but did not change the code. Read the ` +
            'answers with get_review. Then give your next verdict with submit_verdict.\n'
        : `yart: the author answered on ${review_id}. Read the new changes with get_diff and ` +
            'since_last_verdict, and the answers with get_review.\n',
    )
    return 0
  }

  const review = await waitForReview({ port, state_dir, review_id, timeout_ms })
  if (review === null) {
    process.stdout.write(`yart: no verdict on ${review_id} in ${minutes} minutes.\n`)
    return 2
  }
  const verdict = latestSubmission(review)
  const who =
    verdict !== null && submissionAuthor(verdict) === 'reviewer' ? 'an AI reviewer' : 'the person'
  const open = review.threads.filter((thread) => thread.status === 'open').length
  process.stdout.write(
    `yart: ${who} gave the verdict ${verdict?.verdict ?? 'unknown'} on ${review_id}, with ` +
      `${open} open comment${open === 1 ? '' : 's'}. Call get_review to read it.\n`,
  )
  return 0
}

export const main = async (argv: readonly string[]): Promise<void> => {
  const command = argv[0]
  if (command === 'await') {
    try {
      process.exitCode = await awaitVerdict(argv.slice(1))
    } catch (cause) {
      process.stderr.write(`yart: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      process.exitCode = 1
    }
    return
  }
  if (command !== undefined && CONTROL_COMMANDS.has(command)) {
    try {
      process.exitCode = await control(command, argv.slice(1))
    } catch (cause) {
      process.stderr.write(`yart: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      process.exitCode = 1
    }
    return
  }

  if (argv[0] === 'reviewer') {
    try {
      process.exitCode = await reviewer(argv.slice(1))
    } catch (cause) {
      process.stderr.write(`yart: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      process.exitCode = 1
    }
    return
  }

  if (argv[0] === 'hook') {
    try {
      process.exitCode = await hook(argv.slice(1))
    } catch (cause) {
      // A hook that fails must stop the commit, and say why.
      const message = cause instanceof Error ? cause.message : String(cause)
      process.stderr.write(`yart: ${message}\n`)
      process.exitCode = 1
    }
    return
  }

  const { values } = parseArgs({
    args: [...argv],
    options: {
      port: { type: 'string', short: 'p' },
      repo: { type: 'string', short: 'r' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

  if (values.version === true) {
    process.stdout.write(`yart ${VERSION}\n`)
    return
  }

  if (values.help === true) {
    process.stdout.write(
      [
        'yart — local code review for AI-generated diffs',
        '',
        'Usage: yart [options]',
        '       yart start|stop|restart|status [--port <port>]',
        '       yart open [review-id] [--port <port>]',
        '       yart await <review-id> [--author] [--port <port>] [--timeout <minutes>]',
        '       yart hook <install|uninstall|pre-commit>',
        '       yart reviewer <install|uninstall> [--user]',
        '',
        `  -p, --port <port>  Port to listen on (default: ${DEFAULT_PORT})`,
        '  -r, --repo <path>  Repository for requests that name none (default: the current one)',
        '  -v, --version      Show the version',
        '  -h, --help         Show this message',
        '',
        'Serves reviews for any repository a request names. Set YART_HOME to keep',
        'its list of repositories somewhere other than ~/.yart.',
        '',
      ].join('\n'),
    )
    return
  }

  const port = parsePort(values.port)

  const repo_path = await defaultRepo(values.repo)
  const state_dir = defaultStateDir()
  const token = makeToken()
  // The servers exist only after createServer. Thus the shutdown reads them from a holder.
  const holder: { server: Server | null; ipv6: Server | null } = { server: null, ipv6: null }
  const app = createServer({
    // A new token at each start. A token that leaked before does not work after a restart.
    auth: { token, ui_token: makeToken(), cookie_name: `yart_${port}` },
    repo_path,
    state_dir,
    shutdown: () => {
      holder.ipv6?.close()
      holder.ipv6?.closeAllConnections()
      holder.server?.close(() => process.exit(0))
      holder.server?.closeAllConnections()
    },
  })

  // The daemon can read all files in all repositories that it served. Thus other
  // computers must not connect to it. Each client uses this same address, not
  // `localhost`, because a different process could listen on `::1`.
  holder.server = serve({ fetch: app.fetch, port, hostname: LOOPBACK }, (info) => {
    // Only after the listen. A daemon that cannot get the port must not replace
    // the token of the daemon that has it.
    const fail = (message: string) => {
      process.stderr.write(`yart: ${message}\n`)
      process.exit(1)
    }
    void listenOnIpv6(app.fetch, info.port).then(
      async (ipv6) => {
        holder.ipv6 = ipv6
        await writeToken(state_dir, info.port, token).catch((cause: unknown) =>
          fail(`cannot write the token: ${String(cause)}`),
        )
        process.stdout.write(`yart serving reviews, remembering repositories in ${state_dir}\n`)
        process.stdout.write(
          `listening on ${daemonUrl(info.port)}, with the UI on ${uiUrl(info.port)}. ` +
            'Run yart open to sign in.\n',
        )
      },
      (cause: Error) => fail(cause.message),
    )
  }) as Server
}

main(process.argv.slice(2)).catch((cause: unknown) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
