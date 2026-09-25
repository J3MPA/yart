import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findGitCommonDir } from './git.ts'
import { createServer } from './server.ts'
import { TestRepo } from './test-repo.ts'
import type { Review } from './types.ts'

let repo_a: TestRepo
let repo_b: TestRepo
let state_dir: string

beforeEach(() => {
  repo_a = new TestRepo()
  repo_a.write('only-in-a.txt', 'a\n')
  repo_a.commit('base a')
  repo_a.write('only-in-a.txt', 'a changed\n')

  repo_b = new TestRepo()
  repo_b.write('only-in-b.txt', 'b\n')
  repo_b.commit('base b')
  repo_b.write('only-in-b.txt', 'b changed\n')

  state_dir = mkdtempSync(join(tmpdir(), 'yart-state-'))
})

afterEach(() => {
  repo_a.dispose()
  repo_b.dispose()
  rmSync(state_dir, { recursive: true, force: true })
})

const send = async (app: Hono, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const open = async (app: Hono, repo_path?: string): Promise<Review> => {
  const response = await send(app, 'POST', '/api/reviews', { repo_path })
  expect(response.status).toBe(201)
  return (await response.json()) as Review
}

/**
 * Where git says a repository is, which on macOS is past the `/var` symlink the
 * temporary directory sits behind — and so what a review records.
 */
const real = (path: string): string => realpathSync(path)

/** A daemon started in repository A, as one would be by the first agent to ask. */
const daemonIn = (repo: TestRepo) => createServer({ repo_path: repo.path, state_dir })

describe('one daemon for every repository', () => {
  it('reviews the repository a request names, not the one it was started in', async () => {
    // The bug this exists for: a daemon from A reused for a review in B used to
    // snapshot A's working tree, with no error.
    const review = await open(daemonIn(repo_a), repo_b.path)
    expect(review.repo_path).toBe(real(repo_b.path))
    expect(review.files.map((file) => file.path)).toEqual(['only-in-b.txt'])
  })

  it('keeps each review in its own repository', async () => {
    const app = daemonIn(repo_a)
    const in_a = await open(app, repo_a.path)
    const in_b = await open(app, repo_b.path)

    const store = async (repo: TestRepo) =>
      join(await findGitCommonDir(repo.path), 'yart', 'reviews')
    expect(existsSync(join(await store(repo_a), `${in_a.id}.json`))).toBe(true)
    expect(existsSync(join(await store(repo_b), `${in_b.id}.json`))).toBe(true)
    expect(existsSync(join(await store(repo_a), `${in_b.id}.json`))).toBe(false)
  })

  it('lists reviews from every repository, newest first', async () => {
    const app = daemonIn(repo_a)
    const first = await open(app, repo_a.path)
    const second = await open(app, repo_b.path)

    const listed = (await (await send(app, 'GET', '/api/reviews')).json()) as Review[]
    expect(listed.map((review) => review.id)).toEqual([second.id, first.id])
  })

  it('finds a review by id whichever repository holds it', async () => {
    const app = daemonIn(repo_a)
    const in_b = await open(app, repo_b.path)

    const fetched = (await (await send(app, 'GET', `/api/reviews/${in_b.id}`)).json()) as Review
    expect(fetched.repo_path).toBe(real(repo_b.path))
  })

  it('writes to the repository that holds the review', async () => {
    const app = daemonIn(repo_a)
    const in_b = await open(app, repo_b.path)

    const response = await send(app, 'POST', `/api/reviews/${in_b.id}/threads`, {
      path: 'only-in-b.txt',
      line: 1,
      body: 'lands in b',
    })
    expect(response.status).toBe(201)
    const reread = (await (await send(app, 'GET', `/api/reviews/${in_b.id}`)).json()) as Review
    expect(reread.threads[0]?.comments[0]?.body).toBe('lands in b')
  })

  it('falls back to the repository it was started in when a request names none', async () => {
    // What an agent still running an older yart sends; it must keep working.
    const review = await open(daemonIn(repo_a))
    expect(review.repo_path).toBe(real(repo_a.path))
  })

  it('reviews the whole repository when given a directory inside it', async () => {
    const nested = join(repo_b.path, 'deep', 'inside')
    mkdirSync(nested, { recursive: true })
    const review = await open(daemonIn(repo_a), nested)
    expect(review.repo_path).toBe(real(repo_b.path))
  })

  it('refuses a path that is not a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'yart-not-a-repo-'))
    try {
      const response = await send(daemonIn(repo_a), 'POST', '/api/reviews', { repo_path: plain })
      expect(response.status).toBe(400)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('answers an unknown review id with a 404', async () => {
    const response = await send(daemonIn(repo_a), 'GET', '/api/reviews/no-such-review')
    expect(response.status).toBe(404)
  })
})

describe('remembering repositories across restarts', () => {
  it('finds a review in another repository after the daemon is restarted', async () => {
    const in_b = await open(daemonIn(repo_a), repo_b.path)

    // A fresh daemon has only ever heard of A, until it reads what it was told.
    const restarted = daemonIn(repo_a)
    const response = await send(restarted, 'GET', `/api/reviews/${in_b.id}`)
    expect(response.status).toBe(200)
    const listed = (await (await send(restarted, 'GET', '/api/reviews')).json()) as Review[]
    expect(listed.map((review) => review.id)).toContain(in_b.id)
  })

  it('keeps nothing on disk when given nowhere to keep it', async () => {
    const in_memory = createServer({ repo_path: repo_a.path })
    await open(in_memory, repo_b.path)
    expect(existsSync(join(state_dir, 'repositories.json'))).toBe(false)
  })

  it('keeps listing when a remembered repository has gone', async () => {
    const app = daemonIn(repo_a)
    await open(app, repo_b.path)
    const in_a = await open(app, repo_a.path)
    repo_b.dispose()

    const restarted = daemonIn(repo_a)
    const response = await send(restarted, 'GET', '/api/reviews')
    expect(response.status).toBe(200)
    const listed = (await response.json()) as Review[]
    expect(listed.map((review) => review.id)).toEqual([in_a.id])
  })

  it('starts empty rather than failing when the file is unreadable', async () => {
    writeFileSync(join(state_dir, 'repositories.json'), 'not json')
    const review = await open(daemonIn(repo_a), repo_b.path)
    expect(review.repo_path).toBe(real(repo_b.path))
  })
})

describe('worktrees under one daemon', () => {
  it('lists a review opened from a worktree once, recorded against that worktree', async () => {
    const worktree = repo_a.addWorktree('feature')
    writeFileSync(join(worktree, 'only-in-a.txt'), 'changed in the worktree\n')

    const app = daemonIn(repo_a)
    const from_main = await open(app, repo_a.path)
    const from_worktree = await open(app, worktree)

    expect(from_worktree.repo_path).toBe(real(worktree))
    const listed = (await (await send(app, 'GET', '/api/reviews')).json()) as Review[]
    expect(listed.map((review) => review.id).sort()).toEqual(
      [from_main.id, from_worktree.id].sort(),
    )
  })
})

describe('health', () => {
  it('reports the version, so a client can tell an older daemon apart', async () => {
    const body = (await (await send(daemonIn(repo_a), 'GET', '/health')).json()) as {
      version?: string
    }
    expect(typeof body.version).toBe('string')
  })
})

describe('writes a web page could send', () => {
  it('refuses a plain-text POST, which a browser sends cross-origin without asking', async () => {
    const response = await daemonIn(repo_a).request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ repo_path: repo_b.path }),
    })
    expect(response.status).toBe(415)
    expect(existsSync(join(await findGitCommonDir(repo_b.path), 'yart'))).toBe(false)
  })

  it('refuses a form-encoded POST for the same reason', async () => {
    const response = await daemonIn(repo_a).request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'repo_path=anything',
    })
    expect(response.status).toBe(415)
  })

  it('accepts JSON, which a browser will only send cross-origin after asking', async () => {
    const response = await send(daemonIn(repo_a), 'POST', '/api/reviews', {
      repo_path: repo_b.path,
    })
    expect(response.status).toBe(201)
  })

  it('leaves reads alone', async () => {
    const response = await daemonIn(repo_a).request('/api/reviews')
    expect(response.status).toBe(200)
  })
})
