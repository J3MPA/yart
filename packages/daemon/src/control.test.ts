import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorHasAnswered } from '@yart/core'
import { daemonHealth, stopDaemon, waitForReview } from './control.ts'
import { createServer } from './server.ts'
import { TestRepo } from './test-repo.ts'

let repo: TestRepo

beforeEach(() => {
  repo = new TestRepo()
})

afterEach(() => {
  repo.dispose()
})

const listen = async (shutdown?: (http: ServerType) => void) => {
  const holder: { http: ServerType | null } = { http: null }
  const app = createServer({
    repo_path: repo.path,
    shutdown: shutdown === undefined ? undefined : () => holder.http && shutdown(holder.http),
  })
  const http = await new Promise<ServerType>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, () => resolve(server))
  })
  holder.http = http
  return { http, port: (http.address() as AddressInfo).port }
}

const close = (http: ServerType) => new Promise<void>((resolve) => http.close(() => resolve()))

describe('daemonHealth', () => {
  it('reports the repository of a daemon that runs', async () => {
    const { http, port } = await listen()
    expect((await daemonHealth(port))?.repo_path).toBe(repo.path)
    await close(http)
  })

  it('is null when no daemon answers', async () => {
    const { http, port } = await listen()
    await close(http)
    expect(await daemonHealth(port)).toBe(null)
  })
})

describe('stopDaemon', () => {
  it('stops the daemon and waits until it does not answer', async () => {
    const { port } = await listen((http) => {
      http.close()
      ;(http as Server).closeAllConnections()
    })
    expect(await stopDaemon(port)).toBe(true)
    expect(await daemonHealth(port)).toBe(null)
  })

  it('tells when no daemon ran', async () => {
    const { http, port } = await listen()
    await close(http)
    expect(await stopDaemon(port)).toBe(false)
  })

  it('tells how to stop a daemon that cannot stop on request', async () => {
    const { http, port } = await listen()
    await expect(stopDaemon(port)).rejects.toThrow(/older yart/)
    await close(http)
  })
})

describe('waitForReview', () => {
  const post = (port: number, path: string, body: unknown) =>
    fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => response.json() as Promise<{ id: string }>)

  const openReview = async (port: number) => {
    repo.write('a.txt', 'alpha\n')
    repo.commit('base')
    repo.write('a.txt', 'beta\n')
    return post(port, '/api/reviews', {})
  }

  it('returns the review when the verdict comes', async () => {
    const { http, port } = await listen()
    const { id } = await openReview(port)
    setTimeout(() => void post(port, `/api/reviews/${id}/submit`, { verdict: 'approved' }), 100)
    const review = await waitForReview({ port, review_id: id, timeout_ms: 5000, poll_ms: 20 })
    expect(review?.status).toBe('submitted')
    await close(http)
  })

  it('returns null when the time is over', async () => {
    const { http, port } = await listen()
    const { id } = await openReview(port)
    expect(await waitForReview({ port, review_id: id, timeout_ms: 100, poll_ms: 20 })).toBe(null)
    await close(http)
  })

  it('stops for a review that does not exist', async () => {
    const { http, port } = await listen()
    await expect(
      waitForReview({ port, review_id: 'nope', timeout_ms: 1000, poll_ms: 20 }),
    ).rejects.toThrow(/no review/)
    await close(http)
  })

  it('waits for the answer of the author when it is asked to', async () => {
    const { http, port } = await listen()
    const { id } = await openReview(port)
    await post(port, `/api/reviews/${id}/submit`, {
      verdict: 'changes_requested',
      author: 'reviewer',
    })
    setTimeout(() => {
      repo.write('a.txt', 'gamma\n')
      void post(port, `/api/reviews/${id}/advance`, {})
    }, 100)
    const review = await waitForReview({
      port,
      review_id: id,
      timeout_ms: 5000,
      done: authorHasAnswered,
      poll_ms: 20,
    })
    expect(review?.rounds).toHaveLength(2)
    await close(http)
  })
})
