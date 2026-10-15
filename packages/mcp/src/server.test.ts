import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { listenTestDaemon, type TestDaemon } from '@yart/daemon/test-daemon'
import { TestRepo } from '@yart/daemon/test-repo'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer, type McpServerOptions } from './server.ts'

const FOUR_LINES = 'alpha\nbeta\ngamma\ndelta\n'

let repo: TestRepo
let daemon: TestDaemon
let port: number
let client: Client
let reviewer_client: Client
let base: string
let opened: string[]

/** Connects an MCP client to a new MCP server on the daemon of the test. */
const connect = async (options: McpServerOptions): Promise<Client> => {
  const server = createMcpServer({
    port,
    state_dir: daemon.state_dir,
    repo_path: repo.path,
    autostart: false,
    ...options,
  })
  const [client_transport, server_transport] = InMemoryTransport.createLinkedPair()
  const connected = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(server_transport), connected.connect(client_transport)])
  return connected
}

const callOn = async (
  target: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> => {
  const result = await target.callTool({ name, arguments: args })
  const body = (result.content as { type: string; text: string }[])
    .map((block) => block.text)
    .join('\n')
  if (result.isError === true) throw new Error(`tool ${name} failed: ${body}`)
  return body
}

/** Calls a tool of the agent under review and returns its text. */
const call = (name: string, args: Record<string, unknown> = {}) => callOn(client, name, args)

/** Calls a tool of the AI reviewer, on its own server, and returns its text. */
const review = (name: string, args: Record<string, unknown> = {}) =>
  callOn(reviewer_client, name, args)

/** Calls a tool that must fail, and returns the error text. */
const callExpectingError = async (
  name: string,
  args: Record<string, unknown>,
  target: Client = client,
): Promise<string> => {
  const result = await target.callTool({ name, arguments: args })
  expect(result.isError).toBe(true)
  return (result.content as { text: string }[]).map((block) => block.text).join('\n')
}

/** The side of the loop that belongs to the person. The agent cannot do it. */
const humanComments = async (review_id: string, line: number, body: string): Promise<void> => {
  const response = await daemon.asPerson(`/api/reviews/${review_id}/threads`, {
    method: 'POST',
    body: JSON.stringify({ path: 'a.txt', line, body }),
  })
  expect(response.ok).toBe(true)
}

const humanSubmits = async (
  review_id: string,
  verdict: 'commented' | 'approved' | 'changes_requested' = 'commented',
  body?: string,
): Promise<void> => {
  await daemon.asPerson(`/api/reviews/${review_id}/submit`, {
    method: 'POST',
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

  daemon = await listenTestDaemon({ repo_path: repo.path })
  port = daemon.port

  // autostart is off, because the daemon above already listens on this port.
  // The test records the opener and does not run it. Thus the tests never open
  // a browser on the computer of the person who runs them.
  opened = []
  client = await connect({ openBrowser: (url) => opened.push(url) })
  reviewer_client = await connect({ role: 'reviewer', openBrowser: () => undefined })
})

afterEach(async () => {
  await client.close()
  await reviewer_client.close()
  await daemon.close()
  repo.dispose()
})

describe('tool surface', () => {
  it('gives the agent under review the review loop, with no tool that gives a verdict', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'advance_review',
      'await_review',
      'get_review',
      'get_reviewer_settings',
      'list_reviews',
      'reply_to_thread',
      'reply_to_verdict',
      'resolve_thread',
      'start_review',
    ])
  })

  it('gives the reviewer tools only to a server with the reviewer role', async () => {
    const { tools } = await reviewer_client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'await_author',
      'get_diff',
      'get_review',
      'get_reviewer_settings',
      'list_reviews',
      'resolve_thread',
      'submit_verdict',
    ])
    expect(reviewer_client.getInstructions()).toContain('AI reviewer')
  })

  it('refuses a verdict from the agent under review', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    expect(
      await callExpectingError('submit_verdict', { review_id: id, verdict: 'approved' }),
    ).toMatch(/not found/i)
  })

  it('tells the agent to open a review when the person asks for one', () => {
    expect(client.getInstructions()).toContain('call start_review')
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
    expect(rendered).not.toContain(`http://127.0.0.1:${port}/reviews/`)
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
    expect(await call('list_reviews')).toBe('This repository has no reviews.')
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

      const other_client = await connect({ repo_path: other.path, openBrowser: () => undefined })

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
    expect(opened).toEqual([`http://127.0.0.1:${port}/reviews/${review_id}`])
    expect(rendered).toContain('yart opened the review')
  })

  it('tells the agent how to wait in the background, on the port of its daemon', async () => {
    const rendered = await call('start_review', { base })
    expect(rendered).toContain(`yart await ${idFrom(rendered)} --port ${port}`)
    expect(rendered).toContain('Else call await_review')
  })

  it('does not open a window for a review with nothing in it', async () => {
    await call('start_review', { base: 'HEAD' })
    expect(opened).toEqual([])
  })

  it('falls back to asking for the URL to be opened when opening is off', async () => {
    // The real switch, not a replacement. A person configures this path. Thus the
    // test examines the value that they set.
    process.env.YART_NO_BROWSER = '1'
    const quiet_client = await connect({ openBrowser: (url) => opened.push(url) })

    const result = await quiet_client.callTool({ name: 'start_review', arguments: { base } })
    const rendered = (result.content as { text: string }[])[0]?.text ?? ''
    expect(rendered).toContain('Ask the person to open the URL')
    expect(rendered).toContain(`http://127.0.0.1:${port}/reviews/`)
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
    expect(rendered).toContain('You answered the verdict')

    const back = await call('get_review', { review_id })
    expect(back).toContain('agent: Renamed in the previous turn; nothing left to do.')
  })

  it('says so when there is no verdict to answer yet', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    const rendered = await call('reply_to_verdict', { review_id, body: 'hello' })
    expect(rendered).toContain('has no verdict yet')
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
    expect(rendered).toContain('did not submit the review')
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
    daemon.asPerson('/api/settings', { method: 'PATCH', body: JSON.stringify(changes) })

  it('reads how the person wants it run', async () => {
    await settle({ reviewer_model: 'sonnet', reviewer_effort: 'high', ai_review_rounds: 2 })
    const rendered = await call('get_reviewer_settings')
    expect(rendered).toContain('model:        sonnet')
    expect(rendered).toContain('effort:       high')
    expect(rendered).toContain('rounds:       2 verdicts per review')
  })

  it('reads the diff with both line numbers on every line', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    const diff = await review('get_diff', { review_id: id })
    expect(diff).toContain('=== a.txt  [modified]')
    expect(diff).toMatch(/- +2 +beta/)
    expect(diff).toMatch(/\+ +2 +TARGET/)
  })

  it('passes a verdict with its comments, and is told how many rounds it has left', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    const rendered = await review('submit_verdict', {
      review_id: id,
      verdict: 'changes_requested',
      summary: 'One thing.',
      comments: [{ path: 'a.txt', line: 2, body: 'TARGET is shouting' }],
      reviewer_name: 'claude-reviewer',
    })
    expect(rendered).toContain('Verdict: CHANGES REQUESTED by reviewer claude-reviewer')
    expect(rendered).toContain('Round 1 of 3.')
    expect(rendered).toContain(`yart await ${id} --author --port ${port}`)
    expect(rendered).toContain('await_author')
  })

  it('is told to stop on its last round', async () => {
    await settle({ ai_review_rounds: 1 })
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    const rendered = await review('submit_verdict', { review_id: id, verdict: 'changes_requested' })
    expect(rendered).toContain('That was your last round')
  })

  it('hears when the author answers, and only then', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    await review('submit_verdict', {
      review_id: id,
      verdict: 'changes_requested',
      comments: [{ path: 'a.txt', line: 2, body: 'rename this' }],
    })
    expect(await review('await_author', { review_id: id, timeout_seconds: 1 })).toContain(
      'did not answer',
    )
    const author_view = await call('await_review', { review_id: id, timeout_seconds: 1 })
    await call('reply_to_thread', {
      review_id: id,
      thread_id: threadIdFrom(author_view.split('Open comments')[1] ?? ''),
      body: 'I think TARGET is right here.',
    })
    expect(await review('await_author', { review_id: id, timeout_seconds: 1 })).toContain(
      'The author answered',
    )
  })

  it('cannot wait for an answer to a verdict it never passed', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    expect(await callExpectingError('await_author', { review_id: id }, reviewer_client)).toMatch(
      /submit_verdict/,
    )
  })

  it('tells the author when its approval still needs the person', async () => {
    const id = idFrom(await call('start_review', { base, head: 'HEAD' }))
    await review('submit_verdict', { review_id: id, verdict: 'approved' })
    expect(await call('await_review', { review_id: id, timeout_seconds: 1 })).toContain(
      'The person did not examine it yet',
    )
  })
})

describe('images for the agent', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])

  const daemonPost = async (path: string, body: unknown) =>
    (await daemon
      .asPerson(path, { method: 'POST', body: JSON.stringify(body) })
      .then((response) => response.json())) as { id: string }

  it('gives the agent the images of the person, with the numbers from the text', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    const { id } = await daemonPost(`/api/reviews/${review_id}/attachments`, {
      data: PNG.toString('base64'),
    })
    await daemonPost(`/api/reviews/${review_id}/submit`, {
      verdict: 'changes_requested',
      body: 'The button is wrong.',
      attachments: [id],
      threads: [{ path: 'a.txt', line: 2, body: 'and here', attachments: [id] }],
    })

    const result = await client.callTool({
      name: 'await_review',
      arguments: { review_id, timeout_seconds: 5 },
    })
    const blocks = result.content as { type: string; text?: string; data?: string }[]
    const body = blocks[0]?.text ?? ''
    expect(body).toContain('The button is wrong.  [image 1]')
    expect(body).toContain('human: and here  [image 1]')
    expect(blocks.filter((block) => block.type === 'image')).toEqual([
      // eslint-disable-next-line @typescript-eslint/naming-convention -- MCP wire field
      { type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' },
    ])
  })
})

describe('images from the agent', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])

  it('attaches an image file to an answer', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanComments(review_id, 2, 'the color is wrong')
    await humanSubmits(review_id, 'changes_requested')
    const thread_id = threadIdFrom(
      (await call('await_review', { review_id, timeout_seconds: 5 })).split('Open comments')[1] ??
        '',
    )
    writeFileSync(join(repo.path, 'fix.png'), PNG)

    await call('reply_to_thread', {
      review_id,
      thread_id,
      body: 'Fixed. See the screenshot.',
      image_paths: ['fix.png'],
    })
    expect(await call('get_review', { review_id })).toContain(
      'agent: Fixed. See the screenshot.  [image 1]',
    )
  })

  it('tells when the image file does not exist', async () => {
    const review_id = idFrom(await call('start_review', { base }))
    await humanSubmits(review_id, 'changes_requested')
    expect(
      await callExpectingError('reply_to_verdict', {
        review_id,
        body: 'Done.',
        image_paths: ['missing.png'],
      }),
    ).toMatch(/No file at/)
  })
})
