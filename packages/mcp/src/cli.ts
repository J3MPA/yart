#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --experimental-strip-types
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { VERSION } from '@yart/daemon'
import { DEFAULT_PORT } from './daemon-client.ts'
import { createMcpServer, MCP_ROLES, type McpRole } from './server.ts'

export const main = async (argv: readonly string[]): Promise<void> => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      port: { type: 'string', short: 'p' },
      repo: { type: 'string', short: 'r' },
      role: { type: 'string' },
      'no-autostart': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

  // The MCP protocol does not start before this, thus stdout is free.
  if (values.version === true) {
    process.stdout.write(`yart-mcp ${VERSION}\n`)
    return
  }

  if (values.help === true) {
    // stdout carries the MCP protocol. Thus the help goes to stderr.
    process.stderr.write(
      [
        'yart-mcp — MCP server exposing yart review tools',
        '',
        'Usage: yart-mcp [options]',
        '',
        '  -p, --port <port>  Daemon port (default: 7777)',
        '  -r, --repo <path>  Repository to review (default: the current one)',
        '      --role <role>  author: the tools of the agent under review (default)',
        '                     reviewer: the tools of an AI reviewer',
        '      --no-autostart Fail instead of starting a daemon',
        '  -v, --version      Show the version',
        '  -h, --help         Show this message',
        '',
        'A new review opens in the yart app, or your browser without it. Set YART_NO_BROWSER=1 to stop that.',
        '',
      ].join('\n'),
    )
    return
  }

  const role = values.role ?? 'author'
  if (!(MCP_ROLES as readonly string[]).includes(role)) {
    throw new Error(`Invalid role: ${role}. Use ${MCP_ROLES.join(' or ')}.`)
  }

  const server = createMcpServer({
    role: role as McpRole,
    port: values.port === undefined ? DEFAULT_PORT : Number(values.port),
    repo_path: values.repo ?? process.cwd(),
    autostart: values['no-autostart'] !== true,
    // The `yart-mcp` in the desktop app sets this, to point to the daemon of the app.
    daemon_cli: process.env.YART_DAEMON_CLI,
  })

  await server.connect(new StdioServerTransport())
}

main(process.argv.slice(2)).catch((cause: unknown) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
