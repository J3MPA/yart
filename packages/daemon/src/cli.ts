#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { findRepoRoot } from './git.ts'
import { createServer } from './server.ts'

const DEFAULT_PORT = 7777

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
        '  -r, --repo <path>  Repository to review (default: the current one)',
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
  const app = createServer({ repo_path })

  serve({ fetch: app.fetch, port }, (info) => {
    process.stdout.write(`yart reviewing ${repo_path}\n`)
    process.stdout.write(`listening on http://localhost:${info.port}\n`)
  })
}

main(process.argv.slice(2)).catch((cause: unknown) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
