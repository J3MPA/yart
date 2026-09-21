import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '@yart/daemon'
import { TestRepo } from '@yart/daemon/test-repo'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer } from './server.ts'

const FOUR_LINES = 'alpha\nbeta\ngamma\ndelta\n'

let repo: TestRepo
let http: ServerType
let port: number
let client: Client
let base: string

/** Calls a tool and returns its text, failing loudly if the tool reported an error. */
const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
  const result = await client.callTool({ name, arguments: args })
  const body = (result.content as { type: string; text: string }[])
    .map((block) => block.text)
    .join('\n')
  if (result.isError === true) throw new Error(`tool ${name} failed: ${body}`)
  return body
}

/** Calls a tool expecting failure, returning the error text. */
const callExpectingError = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError).toBe(true)
  return (result.content as { text: string }[]).map((block) => block.text).join('\n')
}

/** The human's side of the loop, which the agent cannot do for itself. */
const humanComments = async (review_id: string, line: number, body: string): Promise<void> => {
  const response = await fetch(`http://localhost:${port}/api/reviews/${review_id}/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'a.txt', line, body }),
  })
  expect(response.ok).toBe(true)
}

const humanSubmits = async (
  review_id: string,
  verdict: 'commented' | 'approved' | 'changes_requested' = 'commented',
  body?: string,
): Promise<void> => {
  await fetch(`http://localhost:${port}/api/reviews/${review_id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verdict, body }),
  })
}

const idFrom = (rendered: string): string => {
  const match = /^Review (\S+)/m.exec(rendered)
  if (match?.[1] === undefined) throw new Error(`no review id in:\n${rendered}`)
  return match[1]
}

const threadIdFrom = (rendered: string): string => {
  const match = /\[([0-9a-f-]{36})\]/.exec(rendered)
  if (match?.[1] === undefined) throw new Error(`no thread id in:\n${rendered}`)
  return match[1]
}

beforeEach(async () => {
  repo = new TestRepo()
  repo.write('a.txt', FOUR_LINES)
  base = repo.commit('base')
  repo.write('a.txt', 'alpha\nTARGET\ngamma\ndelta\n')
  repo.commit('change')

  const app = createServer({ repo_path: repo.path })
  http = await new Promise<ServerType>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, () => resolve(server))
  })
  port = (http.address() as AddressInfo).port

  // autostart is off: the daemon above is already listening on this port.
  const mcp = createMcpServer({ port, repo_path: repo.path, autostart: false })
  const [client_transport, server_transport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([mcp.connect(server_transport), client.connect(client_transport)])
})

afterEach(async () => {
  await client.close()
  await new Promise<void>((resolve) => http.close(() => resolve()))
  repo.dispose()
})

describe('tool surface', () => {
  it('exposes the review loop as tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'advance_review',
      'await_review',
      'get_review',
      'list_reviews',
      'reply_to_thread',
      'resolve_thread',
      'start_review',
    ])
  })

  it('describes every tool, since the description is what the model routes on', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description ?? '').not.toBe('')
    }
  })
})

describe('start_review', () => {
  it('reviews uncommitted work by default, since that is when an agent asks', async () => {
    repo.write('brand-new.txt', 'hello\n')
    const rendered = await call('start_review', { base: 'HEAD' })
    expect(rendered).toContain('title:   Uncommitted changes')
    expect(rendered).toContain('added')
    expect(rendered).toContain('brand-new.txt')
  })

  it('names a committed review after the head commit subject', async () => {
    expect(await call('start_review', { base, head: 'HEAD' })).toContain('title:   change')
  })

  it('says so when there is nothing between the two points', async () => {
    const rendered = await call('start_review', { base: 'HEAD' })
    expect(rendered).toContain('nothing to review')
  })

  it('uses an explicit title when given one', async () => {
    const rendered = await call('start_review', { base, head: 'HEAD', title: 'auth refactor' })
    expect(rendered).toContain('title:   auth refactor')
  })

  it('opens a review and reports the changed files', async () => {
    const rendered = await call('start_review', { base, head: 'HEAD' })
    expect(rendered).toContain('modified  a.txt')
    expect(rendered).toContain(`http://localhost:${port}/reviews/`)
  })

  it('reports a bad revision as a tool error rather than throwing', async () => {
    const message = await callExpectingError('start_review', { base: 'no-such-rev' })
    expect(message).toMatch(/no-such-rev|unknown revision|ambiguous/i)
  })
})

describe('get_review and list_reviews', () => {
  it('reads back an open review', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    expect(await call('get_review', { review_id })).toContain(review_id)
  })

  it('lists reviews', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    expect(await call('list_reviews')).toContain(review_id)
  })

  it('leads each listed review with its title, not a revision range', async () => {
    await call('start_review', { base, title: 'auth refactor' })
    const listed = await call('list_reviews')
    expect(listed).toContain('auth refactor')
    expect(listed).not.toContain('..HEAD')
  })

  it('says so when there are none', async () => {
    expect(await call('list_reviews')).toBe('No reviews yet.')
  })

  it('reports an unknown review as a tool error', async () => {
    expect(await callExpectingError('get_review', { review_id: 'nope' })).toMatch(/no review/i)
  })
})

describe('await_review', () => {
  it('returns rather than hanging when nothing is submitted', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    const rendered = await call('await_review', { review_id, timeout_seconds: 1 })
    expect(rendered).toContain('Not submitted yet')
  })

  it('shows comments written so far when it times out', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'rename this')

    const rendered = await call('await_review', { review_id, timeout_seconds: 1 })
    expect(rendered).toContain('Comments so far (1)')
    expect(rendered).toContain('rename this')
  })

  it('returns the open comments once submitted', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'this name is unclear')
    await humanSubmits(review_id)

    const rendered = await call('await_review', { review_id, timeout_seconds: 5 })
    expect(rendered).toContain('Open comments (1)')
    expect(rendered).toContain('a.txt:2')
    expect(rendered).toContain('>   TARGET')
    expect(rendered).toContain('this name is unclear')
  })

  it('leads with the verdict, because it changes what the agent does next', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'rename this')
    await humanSubmits(review_id, 'changes_requested', 'Naming needs another pass.')

    const rendered = await call('await_review', { review_id, timeout_seconds: 5 })
    expect(rendered).toContain('CHANGES REQUESTED')
    expect(rendered).toContain('Naming needs another pass.')
  })

  it('reports an approval even with nothing open', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanSubmits(review_id, 'approved')

    const rendered = await call('await_review', { review_id, timeout_seconds: 5 })
    expect(rendered).toContain('APPROVED')
  })

  it('says so when a submitted review has nothing open', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanSubmits(review_id)
    expect(await call('await_review', { review_id, timeout_seconds: 5 })).toContain(
      'No open comments.',
    )
  })
})

describe('replying and resolving', () => {
  it('posts a reply attributed to the agent', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'why?')
    const thread_id = threadIdFrom(await call('get_review', { review_id }))

    await call('reply_to_thread', { review_id, thread_id, body: 'renamed it' })
    const rendered = await call('get_review', { review_id })
    expect(rendered).toContain('agent: renamed it')
  })

  it('resolves a thread, taking it out of the open set', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'why?')
    const thread_id = threadIdFrom(await call('get_review', { review_id }))

    await call('resolve_thread', { review_id, thread_id })
    expect(await call('get_review', { review_id })).toContain('Open comments: none.')
  })
})

describe('advance_review', () => {
  it('re-anchors a comment onto new commits', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'look here')
    await humanSubmits(review_id)
    await call('await_review', { review_id, timeout_seconds: 5 })

    repo.write('a.txt', 'inserted\nalpha\nTARGET\ngamma\ndelta\n')
    repo.commit('agent responds')

    const rendered = await call('advance_review', { review_id })
    expect(rendered).toContain('a.txt:3  (moved from a.txt:2)')
    expect(rendered).toContain('round 2')
    expect(rendered).toContain('status:  open')
  })

  it('marks a comment outdated when its line was rewritten', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'look here')
    await humanSubmits(review_id)

    repo.write('a.txt', 'alpha\nREWRITTEN\ngamma\ndelta\n')
    repo.commit('agent rewrites')

    const rendered = await call('advance_review', { review_id })
    expect(rendered).toContain('[OUTDATED')
    expect(rendered).toContain('TARGET')
  })
})
