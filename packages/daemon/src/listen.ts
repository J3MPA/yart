import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { IPV6_LOOPBACK } from './auth.ts'

/**
 * Also listens on `::1`, on the same port. A browser can try `::1` first for the
 * name of the UI. Without this, a different process could listen there and get
 * the cookie of the person. Resolves null when this computer has no IPv6
 * loopback. Then a browser cannot go to `::1` either.
 */
export const listenOnIpv6 = (
  fetch: (request: Request) => Response | Promise<Response>,
  port: number,
) =>
  new Promise<Server | null>((resolve, reject) => {
    const server = serve({ fetch, port, hostname: IPV6_LOOPBACK }, () => resolve(server)) as Server
    server.once('error', (cause: NodeJS.ErrnoException) => {
      if (cause.code === 'EADDRINUSE') {
        reject(
          new Error(
            `a different process listens on [${IPV6_LOOPBACK}]:${port}. A browser can ` +
              'send the sign-in of the person there. Stop that process, or use a different port.',
          ),
        )
      } else {
        resolve(null)
      }
    })
  })
