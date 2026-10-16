import { createServer as createHttpServer, get, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ServerType } from '@hono/node-server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorHasAnswered } from '@yart/core'
import { LOOPBACK } from './auth.ts'
import { daemonHealth, signInUrl, stopDaemon, waitForReview } from './control.ts'
import { listenTestDaemon, type TestDaemon } from './test-daemon.ts'
import { TestRepo } from './test-repo.ts'

let repo: TestRepo

beforeEach(() => {
  repo = new TestRepo()
})

afterEach(() => {
  repo.dispose()
})

const listen = async (shutdown?: (http: ServerType) => void): Promise<TestDaemon> => {
  const holder: { http: ServerType | null } = { http: null }
  const daemon = await listenTestDaemon({
    repo_path: repo.path,
    shutdown: shutdown === undefined ? undefined : () => holder.http && shutdown(holder.http),
  })
  holder.http = daemon.http
  return daemon
}

/** A process on the port that answers as a daemon, but does not know the token. */
const listenImpostor = async (proof?: string): Promise<{ port: number; http: Server }> => {
  const http = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, repo_path: '/elsewhere', version: '9.9.9', proof }))
  })
  await new Promise<void>((resolve) => http.listen(0, LOOPBACK, resolve))
  return { port: (http.address() as AddressInfo).port, http }
}

const closeHttp = (http: Server) => new Promise<void>((resolve) => http.close(() => resolve()))

describe('daemonHealth', () => {
  it('reports the repository of a daemon that proves its token', async () => {
    const daemon = await listen()
    const probe = await daemonHealth(daemon.port, daemon.state_dir)
    expect(probe.state === 'yart' && probe.health.repo_path).toBe(repo.path)
    await daemon.close()
  })

  it('reports none when no daemon answers', async () => {
    const daemon = await listen()
    await daemon.close()
    expect((await daemonHealth(daemon.port, daemon.state_dir)).state).toBe('none')
  })

  it('reports a process that cannot prove the token as foreign', async () => {
    const daemon = await listen()
    for (const proof of [undefined, 'f'.repeat(64)]) {
      const impostor = await listenImpostor(proof)
      expect((await daemonHealth(impostor.port, daemon.state_dir)).state).toBe('foreign')
      await closeHttp(impostor.http)
    }
    await daemon.close()
  })
})

describe('stopDaemon', () => {
  it('stops the daemon and waits until it does not answer', async () => {
    const daemon = await listen((http) => {
      http.close()
      ;(http as Server).closeAllConnections()
    })
    expect(await stopDaemon(daemon.port, daemon.state_dir)).toBe(true)
    expect((await daemonHealth(daemon.port, daemon.state_dir)).state).toBe('none')
    await daemon.close().catch(() => undefined)
  })

  it('tells when no daemon ran', async () => {
    const daemon = await listen()
    await daemon.close()
    expect(await stopDaemon(daemon.port, daemon.state_dir)).toBe(false)
  })

  it('tells how to stop a daemon that cannot stop on request', async () => {
    const daemon = await listen()
    await expect(stopDaemon(daemon.port, daemon.state_dir)).rejects.toThrow(/older yart/)
    await daemon.close()
  })

  it('does not send the token to a process that is not the daemon', async () => {
    const daemon = await listen()
    const seen: (string | undefined)[] = []
    const http = createHttpServer((request, response) => {
      seen.push(request.headers.authorization)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, proof: 'nope' }))
    })
    await new Promise<void>((resolve) => http.listen(0, LOOPBACK, resolve))
    const port = (http.address() as AddressInfo).port
    await expect(stopDaemon(port, daemon.state_dir, 200)).rejects.toThrow(/cannot prove/)
    expect(seen.every((header) => header === undefined)).toBe(true)
    await closeHttp(http)
    await daemon.close()
  })
})

/**
 * Opens a link of the UI as a browser does. A browser sends each name under
 * `.localhost` to this computer, but the resolver of macOS 15 does not know the
 * name. Thus the request goes to the address, with the name in `Host`. A fetch
 * cannot set `Host`.
 */
const openUiLink = (link: string) => {
  const url = new URL(link)
  return new Promise<IncomingMessage>((resolve, reject) => {
    get(
      `http://${LOOPBACK}:${url.port}${url.pathname}${url.search}`,
      { headers: { host: url.host } },
      (response) => {
        response.resume()
        resolve(response)
      },
    ).on('error', reject)
  })
}

describe('signInUrl', () => {
  it('gives a link that works one time', async () => {
    const daemon = await listen()
    const url = await signInUrl(daemon.port, daemon.state_dir, '/reviews/x')
    expect(new URL(url).hostname).toBe(`yart-${daemon.port}.localhost`)
    const first = await openUiLink(url)
    expect(first.statusCode).toBe(303)
    expect(first.headers.location).toBe('/reviews/x')
    expect(first.headers['set-cookie']?.join(';')).toContain('HttpOnly')
    expect((await openUiLink(url)).statusCode).toBe(403)
    await daemon.close()
  })

  it('refuses a process that is not the daemon', async () => {
    const daemon = await listen()
    const impostor = await listenImpostor()
    await expect(signInUrl(impostor.port, daemon.state_dir)).rejects.toThrow(/cannot prove/)
    await closeHttp(impostor.http)
    await daemon.close()
  })
})

describe('waitForReview', () => {
  const openReview = async (daemon: TestDaemon) => {
    repo.write('a.txt', 'alpha\n')
    repo.commit('base')
    repo.write('a.txt', 'beta\n')
    const response = await daemon.asClient('/api/reviews', { method: 'POST', body: '{}' })
    return (await response.json()) as { id: string }
  }

  const wait = (daemon: TestDaemon, review_id: string, timeout_ms: number) =>
    waitForReview({
      port: daemon.port,
      state_dir: daemon.state_dir,
      review_id,
      timeout_ms,
      poll_ms: 20,
    })

  it('returns the review when the verdict comes', async () => {
    const daemon = await listen()
    const { id } = await openReview(daemon)
    setTimeout(
      () =>
        void daemon.asPerson(`/api/reviews/${id}/submit`, {
          method: 'POST',
          body: JSON.stringify({ verdict: 'approved' }),
        }),
      100,
    )
    const review = await wait(daemon, id, 5000)
    expect(review?.status).toBe('submitted')
    await daemon.close()
  })

  it('returns null when the time is over', async () => {
    const daemon = await listen()
    const { id } = await openReview(daemon)
    expect(await wait(daemon, id, 100)).toBe(null)
    await daemon.close()
  })

  it('stops for a review that does not exist', async () => {
    const daemon = await listen()
    await expect(wait(daemon, 'nope', 1000)).rejects.toThrow(/no review/)
    await daemon.close()
  })

  it('waits for the answer of the author when it is asked to', async () => {
    const daemon = await listen()
    const { id } = await openReview(daemon)
    await daemon.asClient(`/api/reviews/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ verdict: 'changes_requested', author: 'reviewer' }),
    })
    setTimeout(() => {
      repo.write('a.txt', 'gamma\n')
      void daemon.asClient(`/api/reviews/${id}/advance`, { method: 'POST', body: '{}' })
    }, 100)
    const review = await waitForReview({
      port: daemon.port,
      state_dir: daemon.state_dir,
      review_id: id,
      timeout_ms: 5000,
      done: authorHasAnswered,
      poll_ms: 20,
    })
    expect(review?.rounds).toHaveLength(2)
    await daemon.close()
  })
})
