#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --experimental-strip-types
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { findRepoRoot } from './git.ts'
import { defaultStateDir } from './repositories.ts'
import { createServer } from './server.ts'

const DEFAULT_PORT = 7777

/**
 * The daemon reads any file in any repository it has served, so it must not be
 * reachable from other machines. Left unset, Node listens on every interface.
 * Clients keep calling it `localhost`, which the browser's per-origin seen
 * state and drafts are keyed on, and which resolves here as well.
 */
const LOOPBACK = '127.0.0.1'

export const main = async (argv: readonly string[]): Promise<void> => {
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
        '',
        `  -p, --port <port>  Port to listen on (default: ${DEFAULT_PORT})`,
        '  -r, --repo <path>  Repository for requests that name none (default: the current one)',
        '',
        'Serves reviews for any repository a request names. Set YART_HOME to keep',
        'its list of repositories somewhere other than ~/.yart.',
        '  -h, --help         Show this message',
        '',
      ].join('\n'),
    )
    return
  }

  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${values.port}`)
  }

  const repo_path = await findRepoRoot(values.repo ?? process.cwd())
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
