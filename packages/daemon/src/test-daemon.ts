import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import { daemonUrl, LOOPBACK, makeToken, writeToken } from './auth.ts'
import { createServer, type ServerAuth, type ServerOptions } from './server.ts'

/** Secrets for a server in a test. Each call gives new secrets. */
export const testAuth = (): ServerAuth => ({
  token: makeToken(),
  ui_token: makeToken(),
  cookie_name: 'yart_test',
})

/** The headers of a client with the token file: the CLI, the hook or an MCP server. */
export const clientHeaders = (auth: ServerAuth): Record<string, string> => ({
  authorization: `Bearer ${auth.token}`,
})

/** The headers of the window of the person, with its cookie. */
export const personHeaders = (auth: ServerAuth): Record<string, string> => ({
  cookie: `${auth.cookie_name}=${auth.ui_token}`,
})

export interface TestDaemon {
  port: number
  url: string
  auth: ServerAuth
  /** Where the token file is. A client in a test reads it from here. */
  state_dir: string
  http: ServerType
  /** Sends a request as the window of the person. */
  asPerson(path: string, init?: RequestInit): Promise<Response>
  /** Sends a request as a client with the token file. */
  asClient(path: string, init?: RequestInit): Promise<Response>
  close: () => Promise<void>
}

/**
 * Starts a daemon on a free port, as the CLI does: on the loopback address, with
 * a token file. Without a `state_dir`, the daemon keeps its state in memory, and
 * the token file goes to a new temporary directory.
 */
export const listenTestDaemon = async (
  options: Omit<ServerOptions, 'auth'>,
): Promise<TestDaemon> => {
  const auth = testAuth()
  const state_dir = options.state_dir ?? mkdtempSync(join(tmpdir(), 'yart-home-'))
  const own_dir = options.state_dir === undefined || options.state_dir === null ? state_dir : null
  const app = createServer({ ...options, auth })
  const http = await new Promise<ServerType>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: LOOPBACK }, () => resolve(server))
  })
  const port = (http.address() as AddressInfo).port
  await writeToken(state_dir, port, auth.token)
  const url = daemonUrl(port)
  const send = (headers: Record<string, string>, path: string, init?: RequestInit) =>
    fetch(`${url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...headers, ...init?.headers },
    })
  return {
    port,
    url,
    auth,
    state_dir,
    http,
    asPerson(path, init) {
      return send(personHeaders(auth), path, init)
    },
    asClient(path, init) {
      return send(clientHeaders(auth), path, init)
    },
    close: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()))
      if (own_dir !== null) rmSync(own_dir, { recursive: true, force: true })
    },
  }
}
