import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Review } from './types.ts'
import { createServer, hostName } from './server.ts'
import { TestRepo } from './test-repo.ts'
import { VERSION } from './version.ts'

const FOUR_LINES = 'alpha\nbeta\ngamma\ndelta\n'

let repo: TestRepo
let app: Hono
let base: string

beforeEach(() => {
  repo = new TestRepo()
  repo.write('a.txt', FOUR_LINES)
  base = repo.commit('base')
  repo.write('a.txt', 'alpha\nTARGET\ngamma\ndelta\n')
  repo.commit('change')
  app = createServer({ repo_path: repo.path })
})

afterEach(() => {
  repo.dispose()
})

const post = async (path: string, body?: unknown): Promise<Response> => {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const patch = async (path: string, body: unknown): Promise<Response> => {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const openReview = async (): Promise<Review> => {
  const response = await post('/api/reviews', { base })
  return (await response.json()) as Review
}

const openReviewWithThread = async (): Promise<{ review: Review; thread_id: string }> => {
  const created = await openReview()
  const response = await post(`/api/reviews/${created.id}/threads`, {
    path: 'a.txt',
    line: 2,
    body: 'why this?',
  })
  const review = (await response.json()) as Review
  return { review, thread_id: review.threads[0]?.id as string }
}

describe('health', () => {
  it('reports the repository it is serving', async () => {
    const body = (await (await app.request('/health')).json()) as { repo_path: string }
    expect(body.repo_path).toBe(repo.path)
  })

  it('reports where its code runs from', async () => {
    const body = (await (await app.request('/health')).json()) as { code_dir: string }
    expect(body.code_dir).toBe(fileURLToPath(new URL('..', import.meta.url)))
  })

  it('stops on request only when it can stop', async () => {
    const post = (target: Hono) =>
      target.request('/api/shutdown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    expect((await post(app)).status).toBe(404)
    const calls: string[] = []
    const stoppable = createServer({ repo_path: repo.path, shutdown: () => calls.push('stop') })
    expect((await post(stoppable)).status).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
    expect(calls).toEqual(['stop'])
  })

  it('reports its version to the app', async () => {
    const body = (await (await app.request('/api/version')).json()) as { version: string }
    expect(body.version).toBe(VERSION)
  })
})

describe('a daemon with no default repository', () => {
  it('refuses a review that does not say which repository it is for', async () => {
    const detached = createServer({ repo_path: null })
    const response = await detached.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base }),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/which repository/)
  })

  it('opens a review in the repository a request names', async () => {
    const detached = createServer({ repo_path: null })
    const response = await detached.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base, repo_path: repo.path }),
    })
    expect(response.status).toBe(201)
  })
})

describe('POST /api/reviews', () => {
  it('creates a review and returns 201', async () => {
    const response = await post('/api/reviews', { base })
    expect(response.status).toBe(201)
    const review = (await response.json()) as Review
    expect(review.files.map((file) => file.path)).toEqual(['a.txt'])
  })

  it('defaults a missing base to HEAD, for reviewing uncommitted work', async () => {
    const response = await post('/api/reviews', {})
    expect(response.status).toBe(201)
    expect(((await response.json()) as Review).base).toBe('HEAD')
  })

  it('reports an unknown revision as a bad request, not a server error', async () => {
    expect((await post('/api/reviews', { base: 'no-such-rev' })).status).toBe(400)
  })
})

describe('GET /api/reviews', () => {
  it('lists created reviews', async () => {
    const created = await openReview()
    const listed = (await (await app.request('/api/reviews')).json()) as Review[]
    expect(listed.map((review) => review.id)).toContain(created.id)
  })

  it('returns the review by id', async () => {
    const created = await openReview()
    const response = await app.request(`/api/reviews/${created.id}`)
    expect(response.status).toBe(200)
    expect(((await response.json()) as Review).id).toBe(created.id)
  })

  it('returns 404 for an unknown review', async () => {
    expect((await app.request('/api/reviews/nope')).status).toBe(404)
  })
})

describe('GET /api/reviews/:id/file', () => {
  it('returns both sides of a file', async () => {
    const created = await openReview()
    const response = await app.request(`/api/reviews/${created.id}/file?path=a.txt`)
    const body = (await response.json()) as { base_content: string; head_content: string }
    expect(body.base_content).toBe(FOUR_LINES)
    expect(body.head_content).toBe('alpha\nTARGET\ngamma\ndelta\n')
  })

  it('requires a path', async () => {
    const created = await openReview()
    expect((await app.request(`/api/reviews/${created.id}/file`)).status).toBe(400)
  })

  it('returns 404 for a file outside the review', async () => {
    const created = await openReview()
    const response = await app.request(`/api/reviews/${created.id}/file?path=nope.txt`)
    expect(response.status).toBe(404)
  })
})

describe('threads', () => {
  it('creates a thread anchored to the commented line', async () => {
    const { review } = await openReviewWithThread()
    expect(review.threads[0]?.context.line).toBe('TARGET')
    expect(review.threads[0]?.anchor_state).toBe('current')
  })

  it('rejects a thread with no body', async () => {
    const created = await openReview()
    const response = await post(`/api/reviews/${created.id}/threads`, {
      path: 'a.txt',
      line: 2,
      body: '   ',
    })
    expect(response.status).toBe(400)
  })

  it('rejects a thread with no line', async () => {
    const created = await openReview()
    const response = await post(`/api/reviews/${created.id}/threads`, { path: 'a.txt', body: 'x' })
    expect(response.status).toBe(400)
  })

  it('appends a comment to a thread', async () => {
    const { review, thread_id } = await openReviewWithThread()
    const response = await post(`/api/reviews/${review.id}/threads/${thread_id}/comments`, {
      body: 'fixed it',
      author: 'agent',
    })
    expect(response.status).toBe(201)
    const updated = (await response.json()) as Review
    expect(updated.threads[0]?.comments).toHaveLength(2)
  })

  it('resolves a thread', async () => {
    const { review, thread_id } = await openReviewWithThread()
    const response = await patch(`/api/reviews/${review.id}/threads/${thread_id}`, {
      status: 'resolved',
    })
    expect(((await response.json()) as Review).threads[0]?.status).toBe('resolved')
  })

  it('rejects an unknown thread status', async () => {
    const { review, thread_id } = await openReviewWithThread()
    const response = await patch(`/api/reviews/${review.id}/threads/${thread_id}`, {
      status: 'maybe',
    })
    expect(response.status).toBe(400)
  })
})

describe('submitting drafted comments', () => {
  it('sends drafted comments with the verdict', async () => {
    const review = await openReview()
    const response = await post(`/api/reviews/${review.id}/submit`, {
      verdict: 'changes_requested',
      threads: [{ path: 'a.txt', line: 2, body: 'held until now' }],
      expected_head_sha: review.head_sha,
    })
    expect(response.status).toBe(200)
    const submitted = (await response.json()) as Review
    expect(submitted.threads[0]?.comments[0]?.body).toBe('held until now')
  })

  it('rejects drafts that are not a list', async () => {
    const review = await openReview()
    const response = await post(`/api/reviews/${review.id}/submit`, { threads: 'nope' })
    expect(response.status).toBe(400)
  })

  it('rejects a draft that is not an object, rather than failing inside', async () => {
    const review = await openReview()
    const response = await post(`/api/reviews/${review.id}/submit`, { threads: [null] })
    expect(response.status).toBe(400)
  })

  it('answers a stale head with a conflict', async () => {
    const review = await openReview()
    const response = await post(`/api/reviews/${review.id}/submit`, {
      verdict: 'approved',
      expected_head_sha: 'an-older-head',
    })
    expect(response.status).toBe(409)
  })
})

describe('the review loop', () => {
  it('submits, advances, and re-anchors in one round trip', async () => {
    const { review, thread_id } = await openReviewWithThread()

    const submitted = (await (await post(`/api/reviews/${review.id}/submit`)).json()) as Review
    expect(submitted.status).toBe('submitted')

    // The agent responds. It adds a line above the line of the comment.
    repo.write('a.txt', 'inserted\nalpha\nTARGET\ngamma\ndelta\n')
    repo.commit('agent responds')

    const advanced = (await (
      await post(`/api/reviews/${review.id}/advance`, { head: 'HEAD' })
    ).json()) as Review

    expect(advanced.status).toBe('open')
    expect(advanced.rounds).toHaveLength(2)

    const thread = advanced.threads.find((candidate) => candidate.id === thread_id)
    expect(thread?.anchor_state).toBe('shifted')
    expect(thread?.anchor?.line).toBe(3)
    expect(thread?.comments[0]?.body).toBe('why this?')
  })

  it('outdates a thread when the agent rewrites the commented line', async () => {
    const { review } = await openReviewWithThread()
    repo.write('a.txt', 'alpha\nREWRITTEN\ngamma\ndelta\n')
    repo.commit('agent rewrites')

    const advanced = (await (await post(`/api/reviews/${review.id}/advance`, {})).json()) as Review

    expect(advanced.threads[0]?.anchor_state).toBe('outdated')
    expect(advanced.threads[0]?.context.line).toBe('TARGET')
  })
})

describe('PATCH /api/reviews/:id', () => {
  it('archives and restores a review', async () => {
    const created = await openReview()

    const archived = (await (
      await patch(`/api/reviews/${created.id}`, { archived: true })
    ).json()) as Review
    expect(archived.archived_at).not.toBeNull()

    const listed = (await (await app.request('/api/reviews')).json()) as Review[]
    expect(listed.map((review) => review.id)).not.toContain(created.id)

    const archived_list = (await (
      await app.request('/api/reviews?archived=true')
    ).json()) as Review[]
    expect(archived_list.map((review) => review.id)).toContain(created.id)

    await patch(`/api/reviews/${created.id}`, { archived: false })
    const restored = (await (await app.request('/api/reviews')).json()) as Review[]
    expect(restored.map((review) => review.id)).toContain(created.id)
  })

  it('rejects a non-boolean', async () => {
    const created = await openReview()
    expect((await patch(`/api/reviews/${created.id}`, { archived: 'yes' })).status).toBe(400)
  })
})

describe('DELETE /api/reviews/:id', () => {
  it('removes a review', async () => {
    const created = await openReview()
    const response = await app.request(`/api/reviews/${created.id}`, { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect((await app.request(`/api/reviews/${created.id}`)).status).toBe(404)
  })
})

describe('GET /api/reviews/:id/diff', () => {
  it('returns hunks with a line number on each side', async () => {
    const created = await openReview()
    const response = await app.request(`/api/reviews/${created.id}/diff`)
    expect(response.status).toBe(200)

    const files = (await response.json()) as {
      path: string
      is_binary: boolean
      hunks: { lines: { kind: string; head_line: number | null; text: string }[] }[]
    }[]
    expect(files.map((file) => file.path)).toEqual(['a.txt'])

    const lines = files[0]?.hunks.flatMap((hunk) => hunk.lines) ?? []
    expect(lines.find((line) => line.kind === 'added')).toMatchObject({
      head_line: 2,
      text: 'TARGET',
    })
    expect(files[0]?.is_binary).toBe(false)
  })

  it('returns 404 for an unknown review', async () => {
    expect((await app.request('/api/reviews/nope/diff')).status).toBe(404)
  })
})

describe('serving the web UI', () => {
  let ui_dir: string
  let ui_app: Hono

  beforeEach(() => {
    ui_dir = mkdtempSync(join(tmpdir(), 'yart-ui-'))
    writeFileSync(join(ui_dir, 'index.html'), '<!doctype html><title>yart</title>')
    mkdirSync(join(ui_dir, 'assets'))
    writeFileSync(join(ui_dir, 'assets', 'index.css'), '.a{color:red}')
    ui_app = createServer({ repo_path: repo.path, ui_dir })
  })

  afterEach(() => {
    rmSync(ui_dir, { recursive: true, force: true })
  })

  it('serves an asset with its content type', async () => {
    const response = await ui_app.request('/assets/index.css')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    expect(await response.text()).toBe('.a{color:red}')
  })

  it('falls back to index.html so client-side routes deep link', async () => {
    const response = await ui_app.request('/reviews/some-id')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>yart</title>')
  })

  it('does not let a traversal escape the build directory', async () => {
    const secret = join(ui_dir, '..', 'yart-secret.txt')
    writeFileSync(secret, 'do not serve me')
    try {
      const response = await ui_app.request('/../yart-secret.txt')
      expect(await response.text()).not.toContain('do not serve me')
    } finally {
      rmSync(secret, { force: true })
    }
  })

  it('keeps API routes ahead of the fallback', async () => {
    const response = await ui_app.request('/api/reviews')
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('explains itself when the UI has not been built', async () => {
    const missing = createServer({ repo_path: repo.path, ui_dir: join(ui_dir, 'nope') })
    const response = await missing.request('/reviews/x')
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('has not been built')
  })
})

describe('settings', () => {
  it('keeps approved reviews unless told otherwise', async () => {
    const body = (await (await app.request('/api/settings')).json()) as { on_approve: string }
    expect(body.on_approve).toBe('keep')
  })

  it('changes what happens on approval, and refuses what is not a choice', async () => {
    const changed = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on_approve: 'archive' }),
    })
    expect(((await changed.json()) as { on_approve: string }).on_approve).toBe('archive')

    const refused = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on_approve: 'shred' }),
    })
    expect(refused.status).toBe(400)
  })
})

describe('settling an approved review', () => {
  // No delay. Thus the clean-up runs when the test lets timers run.
  let settling: Hono

  beforeEach(() => {
    settling = createServer({ repo_path: repo.path, approval_grace_ms: 0 })
  })

  const send = (path: string, method: string, body?: unknown) =>
    settling.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const choose = (on_approve: string) => send('/api/settings', 'PATCH', { on_approve })

  const openOne = async (): Promise<Review> =>
    (await (await send('/api/reviews', 'POST', { base })).json()) as Review

  const timersRun = () => new Promise((resolve) => setTimeout(resolve, 20))

  const fetchReview = (id: string) => settling.request(`/api/reviews/${id}`)

  it('archives it when the settings say so', async () => {
    await choose('archive')
    const review = await openOne()
    await send(`/api/reviews/${review.id}/submit`, 'POST', { verdict: 'approved' })
    await timersRun()
    const settled = (await (await fetchReview(review.id)).json()) as Review
    expect(settled.archived_at).not.toBeNull()
  })

  it('deletes it when the settings say so', async () => {
    await choose('delete')
    const review = await openOne()
    await send(`/api/reviews/${review.id}/submit`, 'POST', { verdict: 'approved' })
    await timersRun()
    expect((await fetchReview(review.id)).status).toBe(404)
  })

  it('leaves it alone when the settings keep it', async () => {
    const review = await openOne()
    await send(`/api/reviews/${review.id}/submit`, 'POST', { verdict: 'approved' })
    await timersRun()
    const settled = (await (await fetchReview(review.id)).json()) as Review
    expect(settled.archived_at).toBeNull()
  })

  it('leaves a review with a verdict other than approval alone', async () => {
    await choose('delete')
    const review = await openOne()
    await send(`/api/reviews/${review.id}/submit`, 'POST', { verdict: 'changes_requested' })
    await timersRun()
    expect((await fetchReview(review.id)).status).toBe(200)
  })

  it('does nothing once the setting is turned off before the time comes', async () => {
    const slow = createServer({ repo_path: repo.path, approval_grace_ms: 30 })
    const request = (path: string, method: string, body?: unknown) =>
      slow.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    await request('/api/settings', 'PATCH', { on_approve: 'delete' })
    const review = (await (await request('/api/reviews', 'POST', { base })).json()) as Review
    await request(`/api/reviews/${review.id}/submit`, 'POST', { verdict: 'approved' })
    await request('/api/settings', 'PATCH', { on_approve: 'keep' })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect((await slow.request(`/api/reviews/${review.id}`)).status).toBe(200)
  })

  it('leaves a review reopened before the time comes to its newer verdict', async () => {
    const slow = createServer({ repo_path: repo.path, approval_grace_ms: 30 })
    const request = (path: string, method: string, body?: unknown) =>
      slow.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    await request('/api/settings', 'PATCH', { on_approve: 'delete' })
    const review = (await (await request('/api/reviews', 'POST', { base })).json()) as Review
    await request(`/api/reviews/${review.id}/submit`, 'POST', { verdict: 'approved' })
    await request(`/api/reviews/${review.id}/submit`, 'POST', { verdict: 'changes_requested' })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect((await slow.request(`/api/reviews/${review.id}`)).status).toBe(200)
  })
})

describe('an AI reviewer', () => {
  const send = (path: string, body: unknown) => post(path, body)

  it('comments under its name', async () => {
    const review = await openReview()
    const response = await send(`/api/reviews/${review.id}/threads`, {
      path: 'a.txt',
      line: 2,
      body: 'this name is unclear',
      author: 'reviewer',
      author_name: 'claude-reviewer',
    })
    const comment = ((await response.json()) as Review).threads[0]?.comments[0]
    expect(comment?.author).toBe('reviewer')
    expect(comment?.author_name).toBe('claude-reviewer')
  })

  it('refuses an author that is not one, and a name for anyone but a reviewer', async () => {
    const review = await openReview()
    const unknown = await send(`/api/reviews/${review.id}/threads`, {
      path: 'a.txt',
      line: 2,
      body: 'x',
      author: 'robot',
    })
    expect(unknown.status).toBe(400)
    const named_human = await send(`/api/reviews/${review.id}/threads`, {
      path: 'a.txt',
      line: 2,
      body: 'x',
      author: 'human',
      author_name: 'me',
    })
    expect(named_human.status).toBe(400)
  })

  it('passes a verdict as itself, with the comments it held', async () => {
    const review = await openReview()
    const response = await send(`/api/reviews/${review.id}/submit`, {
      verdict: 'changes_requested',
      author: 'reviewer',
      author_name: 'claude-reviewer',
      threads: [{ path: 'a.txt', line: 2, body: 'rename this' }],
    })
    const submitted = (await response.json()) as Review
    const verdict = submitted.submissions.at(-1)
    expect(verdict?.author).toBe('reviewer')
    expect(verdict?.author_name).toBe('claude-reviewer')
    expect(submitted.threads[0]?.comments[0]?.author).toBe('reviewer')
  })

  it('leaves the verdict to the person or a reviewer, not the agent under review', async () => {
    const review = await openReview()
    const response = await send(`/api/reviews/${review.id}/submit`, { author: 'agent' })
    expect(response.status).toBe(400)
  })

  it('does not finish a review by approving it: only the person’s approval is cleaned up', async () => {
    const settling = createServer({ repo_path: repo.path, approval_grace_ms: 0 })
    const request = (path: string, method: string, body?: unknown) =>
      settling.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    await request('/api/settings', 'PATCH', { on_approve: 'delete' })
    const opened = (await (await request('/api/reviews', 'POST', { base })).json()) as Review
    await request(`/api/reviews/${opened.id}/submit`, 'POST', {
      verdict: 'approved',
      author: 'reviewer',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await settling.request(`/api/reviews/${opened.id}`)).status).toBe(200)
  })
})

describe('the AI reviewer’s round limit', () => {
  const choose = (changes: Record<string, unknown>) =>
    app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    })

  const reviewerVerdict = (id: string) =>
    post(`/api/reviews/${id}/submit`, { verdict: 'changes_requested', author: 'reviewer' })

  it('refuses a reviewer’s verdict once its rounds are used', async () => {
    await choose({ ai_review_rounds: 2 })
    const review = await openReview()
    expect((await reviewerVerdict(review.id)).status).toBe(200)
    expect((await reviewerVerdict(review.id)).status).toBe(200)
    const refused = await reviewerVerdict(review.id)
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error: string }).error).toMatch(/person/)
  })

  it('still takes the person’s verdict after the reviewer has run out', async () => {
    await choose({ ai_review_rounds: 1 })
    const review = await openReview()
    await reviewerVerdict(review.id)
    expect((await post(`/api/reviews/${review.id}/submit`, { verdict: 'approved' })).status).toBe(
      200,
    )
  })

  it('refuses a limit outside the range', async () => {
    expect((await choose({ ai_review_rounds: 0 })).status).toBe(400)
    expect((await choose({ ai_review_rounds: 2.5 })).status).toBe(400)
  })
})

describe('reviewer settings', () => {
  const choose = (changes: Record<string, unknown>) =>
    app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    })

  it('keeps a preferred model, effort and instructions, and clears them again', async () => {
    const set = (await (
      await choose({
        reviewer_model: ' sonnet ',
        reviewer_effort: 'high',
        reviewer_instructions: 'Look hardest at error handling.',
      })
    ).json()) as Record<string, unknown>
    expect(set.reviewer_model).toBe('sonnet')
    expect(set.reviewer_effort).toBe('high')
    expect(set.reviewer_instructions).toBe('Look hardest at error handling.')

    const cleared = (await (
      await choose({ reviewer_model: '', reviewer_effort: null, reviewer_instructions: null })
    ).json()) as Record<string, unknown>
    expect(cleared.reviewer_model).toBeNull()
    expect(cleared.reviewer_effort).toBeNull()
    expect(cleared.reviewer_instructions).toBeNull()
  })

  it('refuses an effort that is not one', async () => {
    expect((await choose({ reviewer_effort: 'maximum' })).status).toBe(400)
  })
})

describe('the Host header', () => {
  const withHost = (host: string) => app.request('/api/reviews', { headers: { host } })

  it('answers requests to the names of this computer', async () => {
    expect((await withHost('localhost:7777')).status).toBe(200)
    expect((await withHost('127.0.0.1:7777')).status).toBe(200)
    expect((await withHost('[::1]:7777')).status).toBe(200)
    expect((await withHost('LOCALHOST')).status).toBe(200)
  })

  it('refuses a request that a browser sent to a different name', async () => {
    const response = await withHost('evil.example:7777')
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toMatch(/evil\.example/)
  })

  it('refuses a name that only starts like this computer', async () => {
    expect((await withHost('localhost.evil.example')).status).toBe(403)
  })

  it('reads the name without the port', () => {
    expect(hostName('Example.com:80')).toBe('example.com')
    expect(hostName('[::1]:7777')).toBe('[::1]')
    expect(hostName('127.0.0.1')).toBe('127.0.0.1')
  })
})

describe('images on comments', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

  const upload = async (review_id: string, data: Buffer) =>
    post(`/api/reviews/${review_id}/attachments`, { data: data.toString('base64') })

  it('keeps an image, tells its type from the bytes, and sends it back', async () => {
    const review = await openReview()
    const response = await upload(review.id, PNG)
    expect(response.status).toBe(201)
    const attachment = (await response.json()) as { id: string; media_type: string }
    expect(attachment.media_type).toBe('image/png')

    const image = await app.request(`/api/reviews/${review.id}/attachments/${attachment.id}`)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG)
  })

  it('refuses a file that is not an image', async () => {
    const review = await openReview()
    expect((await upload(review.id, Buffer.from('<svg onload="x"/>'))).status).toBe(415)
  })

  it('puts images on a comment, a reply and a verdict', async () => {
    const { review, thread_id } = await openReviewWithThread()
    const { id } = (await (await upload(review.id, PNG)).json()) as { id: string }

    const commented = (await (
      await post(`/api/reviews/${review.id}/threads/${thread_id}/comments`, {
        body: 'see this',
        attachments: [id],
      })
    ).json()) as Review
    expect(commented.threads[0]?.comments[1]?.attachments).toEqual([
      { id, media_type: 'image/png' },
    ])

    const submitted = (await (
      await post(`/api/reviews/${review.id}/submit`, {
        verdict: 'changes_requested',
        body: 'it is wrong',
        attachments: [id],
        threads: [{ path: 'a.txt', line: 3, body: 'here too', attachments: [id] }],
      })
    ).json()) as Review
    expect(submitted.submissions[0]?.attachments).toEqual([{ id, media_type: 'image/png' }])
    expect(submitted.threads[1]?.comments[0]?.attachments).toHaveLength(1)
  })

  it('refuses an image that the review does not have', async () => {
    const { review, thread_id } = await openReviewWithThread()
    const response = await post(`/api/reviews/${review.id}/threads/${thread_id}/comments`, {
      body: 'see this',
      attachments: ['0'.repeat(64)],
    })
    expect(response.status).toBe(400)
  })

  it('removes the images with the review', async () => {
    const review = await openReview()
    const { id } = (await (await upload(review.id, PNG)).json()) as { id: string }
    await app.request(`/api/reviews/${review.id}`, { method: 'DELETE' })
    await openReview()
    const other = await openReview()
    expect((await app.request(`/api/reviews/${other.id}/attachments/${id}`)).status).toBe(404)
  })
})
