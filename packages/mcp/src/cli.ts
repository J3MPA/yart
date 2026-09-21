#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --experimental-strip-types
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_PORT } from './daemon-client.ts'
import { createMcpServer } from './server.ts'

export const main = async (argv: readonly string[]): Promise<void> => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      port: { type: 'string', short: 'p' },
      repo: { type: 'string', short: 'r' },
      'no-autostart': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help === true) {
    // stdout carries the MCP protocol, so help goes to stderr.
    process.stderr.write(
      [
        'yart-mcp — MCP server exposing yart review tools',
        '',
        'Usage: yart-mcp [options]',
        '',
        '  -p, --port <port>  Daemon port (default: 7777)',
        '  -r, --repo <path>  Repository to review (default: the current one)',
        '      --no-autostart Fail instead of starting a daemon',
        '  -h, --help         Show this message',
        '',
      ].join('\n'),
    )
    return
  }

  const server = createMcpServer({
    port: values.port === undefined ? DEFAULT_PORT : Number(values.port),
    repo_path: values.repo ?? process.cwd(),
    autostart: values['no-autostart'] !== true,
  })

  await server.connect(new StdioServerTransport())
}

main(process.argv.slice(2)).catch((cause: unknown) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
