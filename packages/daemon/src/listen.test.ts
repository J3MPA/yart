import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { IPV6_LOOPBACK, LOOPBACK } from './auth.ts'
import { listenOnIpv6 } from './listen.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  )
})

/** A plain server on an address. Resolves null when the address is not on this computer. */
const listen = (host: string, port: number) =>
  new Promise<Server | null>((resolve) => {
    const server = createServer((_request, response) => response.end('other'))
    server.once('error', () => resolve(null))
    server.listen(port, host, () => {
      servers.push(server)
      resolve(server)
    })
  })

const daemonPort = async (): Promise<number> => {
  const ipv4 = await listen(LOOPBACK, 0)
  return (ipv4?.address() as AddressInfo).port
}

describe('listenOnIpv6', () => {
  it('answers on ::1, on the port of the daemon', async () => {
    const port = await daemonPort()
    const ipv6 = await listenOnIpv6(() => new Response('yart'), port)
    // A computer with no IPv6 loopback has nothing to protect there.
    if (ipv6 === null) return
    servers.push(ipv6)
    expect(await (await fetch(`http://[${IPV6_LOOPBACK}]:${port}/`)).text()).toBe('yart')
  })

  it('refuses to start when a different process listens on ::1 on the port', async () => {
    const port = await daemonPort()
    if ((await listen(IPV6_LOOPBACK, port)) === null) return
    await expect(listenOnIpv6(() => new Response('yart'), port)).rejects.toThrow(
      /a different process listens on \[::1\]/i,
    )
  })
})
