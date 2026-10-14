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
let opened: string[]

/** Calls a tool and returns its text. Fails clearly if the tool gave an error. */
const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
  const result = await client.callTool({ name, arguments: args })
  const body = (result.content as { type: string; text: string }[])
    .map((block) => block.text)
    .join('\n')
  if (result.isError === true) throw new Error(`tool ${name} failed: ${body}`)
  return body
}

/** Calls a tool that must fail, and returns the error text. */
const callExpectingError = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError).toBe(true)
  return (result.content as { text: string }[]).map((block) => block.text).join('\n')
}

/** The side of the loop that belongs to the person. The agent cannot do it. */
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

  // autostart is off, because the daemon above already listens on this port.
  // The test records the opener and does not run it. Thus the tests never open
  // a browser on the computer of the person who runs them.
  opened = []
  const mcp = createMcpServer({
    port,
    repo_path: repo.path,
    autostart: false,
    openBrowser: (url) => opened.push(url),
  })
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
      'await_author',
      'await_review',
      'get_diff',
      'get_review',
      'get_reviewer_settings',
      'list_reviews',
      'reply_to_thread',
      'reply_to_verdict',
      'resolve_thread',
      'start_review',
      'submit_verdict',
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

describe('an agent in another repository', () => {
  it('reviews its own repository through a daemon started in a different one', async () => {
    // The daemon in beforeEach started for `repo`. An agent in a second
    // repository uses it, as each agent uses the daemon on the port. Before, that
    // agent got a review of the working tree of the first repository.
    const other = new TestRepo()
    try {
      other.write('elsewhere.txt', 'one\n')
      other.commit('base')
      other.write('elsewhere.txt', 'one\ntwo\n')

      const agent = createMcpServer({
        port,
        repo_path: other.path,
        autostart: false,
        openBrowser: () => undefined,
      })
      const [client_transport, server_transport] = InMemoryTransport.createLinkedPair()
      const other_client = new Client({ name: 'other', version: '0.0.0' })
      await Promise.all([agent.connect(server_transport), other_client.connect(client_transport)])

      const result = await other_client.callTool({ name: 'start_review', arguments: {} })
      const rendered = (result.content as { text: string }[])[0]?.text ?? ''
      expect(rendered).toContain('elsewhere.txt')
      expect(rendered).not.toContain('a.txt')

      await other_client.close()
    } finally {
      other.dispose()
    }
  })
})

describe('opening the review', () => {
  it('shows a new review to the person who has to read it', async () => {
    const rendered = await call('start_review', { base })
    const review_id = idFrom(rendered)
    expect(opened).toEqual([`http://localhost:${port}/reviews/${review_id}`])
    expect(rendered).toContain('Opened it for them')
  })

  it('does not open a window for a review with nothing in it', async () => {
    await call('start_review', { base: 'HEAD' })
    expect(opened).toEqual([])
  })

  it('falls back to asking for the URL to be opened when opening is off', async () => {
    // The real switch, not a replacement. A person configures this path. Thus the
    // test examines the value that they set.
    process.env.YART_NO_BROWSER = '1'
    const quiet = createMcpServer({
      port,
      repo_path: repo.path,
      autostart: false,
      openBrowser: (url) => opened.push(url),
    })
    const [client_transport, server_transport] = InMemoryTransport.createLinkedPair()
    const quiet_client = new Client({ name: 'quiet', version: '0.0.0' })
    await Promise.all([quiet.connect(server_transport), quiet_client.connect(client_transport)])

    const result = await quiet_client.callTool({ name: 'start_review', arguments: { base } })
    const rendered = (result.content as { text: string }[])[0]?.text ?? ''
    expect(rendered).toContain('Ask the human to open that URL')
    expect(opened).toEqual([])

    await quiet_client.close()
    delete process.env.YART_NO_BROWSER
  })
})

describe('reply_to_verdict', () => {
  it('answers the summary without being told which verdict it is', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanSubmits(review_id, 'changes_requested', 'Naming needs another pass.')

    const rendered = await call('reply_to_verdict', {
      review_id,
      body: 'Renamed in the previous turn; nothing left to do.',
    })
    expect(rendered).toContain('Replied to the verdict')

    const back = await call('get_review', { review_id })
    expect(back).toContain('agent: Renamed in the previous turn; nothing left to do.')
  })

  it('says so when there is no verdict to answer yet', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    const rendered = await call('reply_to_verdict', { review_id, body: 'hello' })
    expect(rendered).toContain('not been submitted yet')
  })

  it('reports an unknown verdict as a tool error rather than throwing', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanSubmits(review_id)
    const message = await callExpectingError('reply_to_verdict', {
      review_id,
      submission_id: 'nope',
      body: 'hello',
    })
    expect(message).toContain('nope')
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

describe('an AI reviewer', () => {
  const settle = (changes: Record<string, unknown>) =>
    fetch(`http://localhost:${port}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    })

  it('reads how the person wants it run', async () => {
    await settle({ reviewer_model: 'sonnet', reviewer_effort: 'high', ai_review_rounds: 2 })
    const rendered = await call('get_reviewer_settings')
    expect(rendered).toContain('model:        sonnet')
    expect(rendered).toContain('effort:       high')
    expect(rendered).toContain('rounds:       2 verdicts per review')
  })

  it('reads the diff with both line numbers on every line', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    const diff = await call('get_diff', { review_id: id })
    expect(diff).toContain('=== a.txt  [modified]')
    expect(diff).toMatch(/- +2 +beta/)
    expect(diff).toMatch(/\+ +2 +TARGET/)
  })

  it('passes a verdict with its comments, and is told how many rounds it has left', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    const rendered = await call('submit_verdict', {
      review_id: id,
      verdict: 'changes_requested',
      summary: 'One thing.',
      comments: [{ path: 'a.txt', line: 2, body: 'TARGET is shouting' }],
      reviewer_name: 'claude-reviewer',
    })
    expect(rendered).toContain('Verdict: CHANGES REQUESTED by reviewer claude-reviewer')
    expect(rendered).toContain('Round 1 of 3.')
    expect(rendered).toContain('await_author')
  })

  it('is told to stop on its last round', async () => {
    await settle({ ai_review_rounds: 1 })
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    const rendered = await call('submit_verdict', { review_id: id, verdict: 'changes_requested' })
    expect(rendered).toContain('That was your last round')
  })

  it('hears when the author answers, and only then', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    await call('submit_verdict', {
      review_id: id,
      verdict: 'changes_requested',
      comments: [{ path: 'a.txt', line: 2, body: 'rename this' }],
    })
    expect(await call('await_author', { review_id: id, timeout_seconds: 1 })).toContain(
      'has not answered',
    )
    const author_view = await call('await_review', { review_id: id, timeout_seconds: 1 })
    await call('reply_to_thread', {
      review_id: id,
      thread_id: threadIdFrom(author_view.split('Open comments')[1] ?? ''),
      body: 'I think TARGET is right here.',
    })
    expect(await call('await_author', { review_id: id, timeout_seconds: 1 })).toContain(
      'The author has answered',
    )
  })

  it('cannot wait for an answer to a verdict it never passed', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    expect(await callExpectingError('await_author', { review_id: id })).toMatch(/submit_verdict/)
  })

  it('tells the author when its approval still needs the person', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    await call('submit_verdict', { review_id: id, verdict: 'approved' })
    expect(await call('await_review', { review_id: id, timeout_seconds: 1 })).toContain(
      'the person has not looked yet',
    )
  })
})
