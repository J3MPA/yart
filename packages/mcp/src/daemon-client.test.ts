import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { listenTestDaemon, type TestDaemon } from '@yart/daemon/test-daemon'
import { TestRepo } from '@yart/daemon/test-repo'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DaemonClient } from './daemon-client.ts'

let repo: TestRepo
let daemon: TestDaemon
let fake: Server | null = null
let seen: { url: string | undefined; authorization: string | undefined }[]

beforeEach(async () => {
  repo = new TestRepo()
  repo.write('a.txt', 'a\n')
  repo.commit('base')
  daemon = await listenTestDaemon({ repo_path: repo.path })
  seen = []
})

afterEach(async () => {
  if (fake !== null) await new Promise<void>((resolve) => fake?.close(() => resolve()))
  fake = null
  await daemon.close()
  repo.dispose()
})

/**
 * A process that answers as a daemon, but does not know the token. A daemon
 * from before the token answers in the same way.
 */
const listenFake = async (host: string, port = 0): Promise<number> => {
  fake = createServer((request, response) => {
    seen.push({ url: request.url, authorization: request.headers.authorization })
    response.setHeader('content-type', 'application/json')
    if (request.url?.startsWith('/health') === true) {
      response.end(JSON.stringify({ ok: true, repo_path: repo.path, version: '9.9.9' }))
      return
    }
    response.end('[]')
  })
  await new Promise<void>((resolve, reject) => {
    fake?.once('error', reject)
    fake?.listen(port, host, resolve)
  })
  return (fake?.address() as AddressInfo).port
}

describe('a process on the port that is not the daemon', () => {
  it('is refused, and never gets the token', async () => {
    const port = await listenFake('127.0.0.1')
    const client = new DaemonClient({
      port,
      repo_path: repo.path,
      autostart: false,
      state_dir: daemon.state_dir,
    })
    await expect(client.listReviews()).rejects.toThrow(/cannot prove/)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((request) => request.authorization === undefined)).toBe(true)
  })

  it('on ::1 does not get the traffic for the daemon on 127.0.0.1', async () => {
    try {
      await listenFake('::1', daemon.port)
    } catch {
      // This computer has no IPv6 loopback. Then no process can listen there.
      return
    }
    const client = new DaemonClient({
      port: daemon.port,
      repo_path: repo.path,
      autostart: false,
      state_dir: daemon.state_dir,
    })
    await expect(client.listReviews()).resolves.toEqual([])
    expect(seen).toEqual([])
  })
})

describe('the daemon', () => {
  it('gets the token on each request', async () => {
    const client = new DaemonClient({
      port: daemon.port,
      repo_path: repo.path,
      autostart: false,
      state_dir: daemon.state_dir,
    })
    await expect(client.listReviews()).resolves.toEqual([])
  })

  it('gives a sign-in link with the origin of the page', async () => {
    const client = new DaemonClient({
      port: daemon.port,
      repo_path: repo.path,
      autostart: false,
      state_dir: daemon.state_dir,
    })
    const link = new URL(await client.signInUrl('http://localhost:5173/reviews/abc?x=1'))
    expect(link.origin).toBe('http://localhost:5173')
    expect(link.pathname).toBe('/sign-in')
    expect(link.searchParams.get('next')).toBe('/reviews/abc?x=1')
    const signed_in = await fetch(
      `${daemon.url}/sign-in?code=${link.searchParams.get('code')}&next=%2F`,
      { redirect: 'manual' },
    )
    expect(signed_in.status).toBe(303)
  })
})
