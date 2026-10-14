#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --experimental-strip-types
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { findRepoRoot, GitError } from './git.ts'
import { installHook, preCommit, uninstallHook } from './hook.ts'
import { defaultStateDir } from './repositories.ts'
import { createServer } from './server.ts'

const DEFAULT_PORT = 7777

/**
 * The daemon can read all files in all repositories that it served. Thus other
 * computers must not connect to it. Without a value, Node listens on all
 * interfaces. Clients still use `localhost`, which also goes to this address.
 * The seen state and the drafts in the browser use that origin as their key.
 */
const LOOPBACK = '127.0.0.1'

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

export const main = async (argv: readonly string[]): Promise<void> => {
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
    },
  })

  if (values.help === true) {
    process.stdout.write(
      [
        'yart — local code review for AI-generated diffs',
        '',
        'Usage: yart [options]',
        '       yart hook <install|uninstall|pre-commit>',
        '',
        `  -p, --port <port>  Port to listen on (default: ${DEFAULT_PORT})`,
        '  -r, --repo <path>  Repository for requests that name none (default: the current one)',
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
  const app = createServer({ repo_path, state_dir })

  serve({ fetch: app.fetch, port, hostname: LOOPBACK }, (info) => {
    process.stdout.write(`yart serving reviews, remembering repositories in ${state_dir}\n`)
    process.stdout.write(`listening on http://localhost:${info.port}\n`)
  })
}

main(process.argv.slice(2)).catch((cause: unknown) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
