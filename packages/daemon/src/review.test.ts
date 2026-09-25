import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReviewError, ReviewService } from './review.ts'
import { ReviewStore } from './store.ts'
import { TestRepo } from './test-repo.ts'

const FOUR_LINES = 'alpha\nbeta\ngamma\ndelta\n'

let repo: TestRepo
let service: ReviewService
let base: string

beforeEach(() => {
  repo = new TestRepo()
  repo.write('a.txt', FOUR_LINES)
  base = repo.commit('base')
  service = new ReviewService(repo.path)
})

afterEach(() => {
  repo.dispose()
})

/** Creates a review over base..HEAD after applying a change. */
const reviewAfter = async (change: () => void) => {
  change()
  repo.commit('change')
  return service.create({ repo_path: repo.path, base, head: 'HEAD' })
}

describe('create', () => {
  it('names the review after the head commit subject', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect(review.title).toBe('change')
  })

  it('prefers an explicit title', async () => {
    repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n')
    repo.commit('change')
    const review = await service.create({
      repo_path: repo.path,
      base,
      head: 'HEAD',
      title: 'auth refactor',
    })
    expect(review.title).toBe('auth refactor')
  })

  it('records the branch at the head', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect(review.head_branch).toBe('main')
  })

  it('starts with no submissions', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect(review.submissions).toEqual([])
  })

  it('records the resolved revision shas', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect(review.base_sha).toBe(base)
    expect(review.head_sha).toBe(repo.git('rev-parse', 'HEAD').trim())
  })

  it('lists the changed files with their blobs', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect(review.files).toHaveLength(1)
    expect(review.files[0]).toMatchObject({ path: 'a.txt', status: 'modified' })
  })

  it('starts open, with no threads and one round', async () => {
    const review = await reviewAfter(() => repo.write('b.txt', 'new\n'))
    expect(review.status).toBe('open')
    expect(review.threads).toEqual([])
    expect(review.rounds).toEqual([review.head_sha])
  })

  it('rejects an unknown revision', async () => {
    await expect(service.create({ repo_path: repo.path, base: 'nope' })).rejects.toThrow()
  })
})

describe('addThread', () => {
  it('anchors to the head blob and captures the line', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    const updated = await service.addThread(review.id, {
      path: 'a.txt',
      line: 2,
      body: 'why?',
    })

    const [thread] = updated.threads
    expect(thread?.context.line).toBe('CHANGED')
    expect(thread?.anchor?.blob_sha).toBe(repo.blobSha('HEAD', 'a.txt'))
    expect(thread?.anchor_state).toBe('current')
    expect(thread?.status).toBe('open')
  })

  it('rejects a path outside the review', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await expect(
      service.addThread(review.id, { path: 'nope.txt', line: 1, body: 'x' }),
    ).rejects.toBeInstanceOf(ReviewError)
  })

  it('rejects a line past the end of the file', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await expect(
      service.addThread(review.id, { path: 'a.txt', line: 999, body: 'x' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects commenting on the head side of a deleted file', async () => {
    repo.write('gone.txt', 'x\n')
    const with_file = repo.commit('add file')
    repo.remove('gone.txt')
    repo.commit('delete it')
    const review = await service.create({ repo_path: repo.path, base: with_file, head: 'HEAD' })

    await expect(
      service.addThread(review.id, { path: 'gone.txt', line: 1, body: 'x' }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('comments and status', () => {
  it('appends a reply to a thread', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    const with_thread = await service.addThread(review.id, { path: 'a.txt', line: 2, body: 'why?' })
    const thread_id = with_thread.threads[0]?.id as string

    const replied = await service.addComment(review.id, thread_id, 'because', 'agent')
    expect(replied.threads[0]?.comments).toHaveLength(2)
    expect(replied.threads[0]?.comments[1]).toMatchObject({ author: 'agent', body: 'because' })
  })

  it('resolves a thread', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    const with_thread = await service.addThread(review.id, { path: 'a.txt', line: 2, body: 'why?' })
    const thread_id = with_thread.threads[0]?.id as string

    const resolved = await service.setThreadStatus(review.id, thread_id, 'resolved')
    expect(resolved.threads[0]?.status).toBe('resolved')
  })

  it('rejects an unknown thread', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await expect(service.addComment(review.id, 'nope', 'x')).rejects.toMatchObject({ status: 404 })
  })

  it('marks the review submitted', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect((await service.submit(review.id)).status).toBe('submitted')
  })

  it('records a verdict and a summary against the head it was passed on', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    const submitted = await service.submit(review.id, {
      verdict: 'changes_requested',
      body: '  Naming needs another pass.  ',
    })

    expect(submitted.submissions).toHaveLength(1)
    expect(submitted.submissions[0]).toMatchObject({
      verdict: 'changes_requested',
      body: 'Naming needs another pass.',
      head_sha: review.head_sha,
    })
  })

  it('defaults to a plain comment with no summary', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect((await service.submit(review.id)).submissions[0]).toMatchObject({
      verdict: 'commented',
      body: null,
    })
  })

  it('keeps every submission, so a re-review does not erase the last one', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await service.submit(review.id, { verdict: 'changes_requested' })
    const again = await service.submit(review.id, { verdict: 'approved' })

    expect(again.submissions.map((entry) => entry.verdict)).toEqual([
      'changes_requested',
      'approved',
    ])
  })

  it('starts a submission with nothing said back to it', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect((await service.submit(review.id)).submissions[0]?.comments).toEqual([])
  })
})

describe('addSubmissionComment', () => {
  it('posts a reply under the verdict it answers', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    const submitted = await service.submit(review.id, { verdict: 'changes_requested' })
    const submission_id = submitted.submissions[0]?.id as string

    const replied = await service.addSubmissionComment(
      review.id,
      submission_id,
      'Already done in the previous turn.',
      'agent',
    )

    expect(replied.submissions[0]?.comments).toMatchObject([
      { author: 'agent', body: 'Already done in the previous turn.' },
    ])
  })

  it('leaves an earlier verdict alone when replying to a later one', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await service.submit(review.id, { verdict: 'changes_requested' })
    const twice = await service.submit(review.id, { verdict: 'approved' })

    const replied = await service.addSubmissionComment(
      review.id,
      twice.submissions[1]?.id as string,
      'Thanks.',
      'agent',
    )

    expect(replied.submissions[0]?.comments).toEqual([])
    expect(replied.submissions[1]?.comments).toHaveLength(1)
  })

  it('rejects an unknown submission', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await expect(service.addSubmissionComment(review.id, 'nope', 'x')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('advanceHead', () => {
  /** Opens a review with one thread on the given line of a.txt. */
  const reviewWithThreadOn = async (line: number, head_content: string) => {
    repo.write('a.txt', head_content)
    repo.commit('first change')
    const review = await service.create({ repo_path: repo.path, base, head: 'HEAD' })
    const updated = await service.addThread(review.id, { path: 'a.txt', line, body: 'look here' })
    return { review_id: review.id, thread_id: updated.threads[0]?.id as string }
  }

  it('shifts a thread down past an insertion above it', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    repo.write('a.txt', 'inserted\nalpha\nTARGET\ngamma\ndelta\n')
    repo.commit('insert above')

    const advanced = await service.advanceHead(review_id, 'HEAD')
    expect(advanced.threads[0]?.anchor_state).toBe('shifted')
    expect(advanced.threads[0]?.anchor?.line).toBe(3)
  })

  it('keeps a thread current when the change is below it', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    repo.write('a.txt', 'alpha\nTARGET\ngamma\ndelta\nappended\n')
    repo.commit('append below')

    const advanced = await service.advanceHead(review_id, 'HEAD')
    expect(advanced.threads[0]?.anchor_state).toBe('current')
  })

  it('outdates a thread whose line was rewritten', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    repo.write('a.txt', 'alpha\nREWRITTEN\ngamma\ndelta\n')
    repo.commit('rewrite the line')

    const advanced = await service.advanceHead(review_id, 'HEAD')
    expect(advanced.threads[0]?.anchor_state).toBe('outdated')
    expect(advanced.threads[0]?.anchor).toBeNull()
  })

  it('keeps the captured context after outdating', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    repo.write('a.txt', 'alpha\nREWRITTEN\ngamma\ndelta\n')
    repo.commit('rewrite the line')

    const advanced = await service.advanceHead(review_id, 'HEAD')
    expect(advanced.threads[0]?.context.line).toBe('TARGET')
    expect(advanced.threads[0]?.comments[0]?.body).toBe('look here')
  })

  it('outdates a thread whose file was deleted', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    repo.remove('a.txt')
    repo.commit('delete the file')

    const advanced = await service.advanceHead(review_id, 'HEAD')
    expect(advanced.threads[0]?.anchor_state).toBe('outdated')
  })

  it('follows a rename', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    repo.move('a.txt', 'moved.txt')
    repo.commit('rename it')

    const advanced = await service.advanceHead(review_id, 'HEAD')
    expect(advanced.threads[0]?.anchor?.path).toBe('moved.txt')
    expect(advanced.threads[0]?.anchor?.line).toBe(2)
  })

  it('records each head it has been through', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    repo.write('a.txt', 'alpha\nTARGET\ngamma\ndelta\nmore\n')
    repo.commit('second round')

    const advanced = await service.advanceHead(review_id, 'HEAD')
    expect(advanced.rounds).toHaveLength(2)
    expect(advanced.rounds[1]).toBe(advanced.head_sha)
  })

  it('reopens a submitted review when the head advances', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    await service.submit(review_id)
    repo.write('a.txt', 'alpha\nTARGET\ngamma\ndelta\nmore\n')
    repo.commit('agent responds')

    expect((await service.advanceHead(review_id, 'HEAD')).status).toBe('open')
  })

  it('is a no-op when the head has not moved', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')
    const before = await service.get(review_id)
    const after = await service.advanceHead(review_id, 'HEAD')
    expect(after.updated_at).toBe(before.updated_at)
  })

  it('survives two rounds, accumulating the shift', async () => {
    const { review_id } = await reviewWithThreadOn(2, 'alpha\nTARGET\ngamma\ndelta\n')

    repo.write('a.txt', 'one\nalpha\nTARGET\ngamma\ndelta\n')
    repo.commit('round two')
    await service.advanceHead(review_id, 'HEAD')

    repo.write('a.txt', 'zero\none\nalpha\nTARGET\ngamma\ndelta\n')
    repo.commit('round three')
    const advanced = await service.advanceHead(review_id, 'HEAD')

    expect(advanced.threads[0]?.anchor?.line).toBe(4)
    expect(advanced.threads[0]?.anchor_state).toBe('shifted')
  })
})

describe('archiving', () => {
  it('hides an archived review from the default listing', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nONE\ngamma\ndelta\n'))
    await service.setArchived(review.id, true)

    expect((await service.list()).map((entry) => entry.id)).not.toContain(review.id)
    expect((await service.list({ archived: true })).map((entry) => entry.id)).toContain(review.id)
  })

  it('keeps the review and its comments, unlike deleting', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nONE\ngamma\ndelta\n'))
    await service.addThread(review.id, { path: 'a.txt', line: 2, body: 'why?' })
    await service.setArchived(review.id, true)

    const archived = await service.get(review.id)
    expect(archived.archived_at).not.toBeNull()
    expect(archived.threads).toHaveLength(1)
  })

  it('restores a review to the active listing', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nONE\ngamma\ndelta\n'))
    await service.setArchived(review.id, true)
    await service.setArchived(review.id, false)

    expect((await service.get(review.id)).archived_at).toBeNull()
    expect((await service.list()).map((entry) => entry.id)).toContain(review.id)
  })

  it('is a no-op when already in that state', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nONE\ngamma\ndelta\n'))
    const first = await service.setArchived(review.id, true)
    const again = await service.setArchived(review.id, true)
    expect(again.archived_at).toBe(first.archived_at)
  })

  it('removes a deleted review entirely', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nONE\ngamma\ndelta\n'))
    await service.remove(review.id)
    await expect(service.get(review.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('persistence', () => {
  it('round-trips a review through disk', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await service.addThread(review.id, { path: 'a.txt', line: 2, body: 'why?' })

    const reloaded = await new ReviewStore(repo.path).load(review.id)
    expect(reloaded?.threads[0]?.context.line).toBe('CHANGED')
    expect(reloaded?.threads[0]?.anchor?.blob_sha).toBe(repo.blobSha('HEAD', 'a.txt'))
  })

  it('gives a submission written before replies existed an empty conversation', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    await service.submit(review.id, { verdict: 'approved' })

    // Rewrite the file as an older yart would have left it, with no `comments`
    // on the submission at all, and check nothing downstream has to cope with
    // the field being absent.
    const file = join(repo.path, '.git', 'yart', 'reviews', `${review.id}.json`)
    const stored = JSON.parse(readFileSync(file, 'utf8')) as {
      submissions: Record<string, unknown>[]
    }
    for (const submission of stored.submissions) delete submission.comments
    writeFileSync(file, JSON.stringify(stored), 'utf8')

    const reloaded = await service.get(review.id)
    expect(reloaded.submissions[0]?.comments).toEqual([])
  })

  it('stores reviews under .git so they stay out of the working tree', async () => {
    const review = await reviewAfter(() => repo.write('a.txt', 'alpha\nCHANGED\ngamma\ndelta\n'))
    expect(repo.git('status', '--porcelain').trim()).toBe('')
    expect(await service.get(review.id)).toMatchObject({ id: review.id })
  })

  it('lists reviews newest first', async () => {
    const first = await reviewAfter(() => repo.write('a.txt', 'alpha\nONE\ngamma\ndelta\n'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await reviewAfter(() => repo.write('a.txt', 'alpha\nTWO\ngamma\ndelta\n'))

    const listed = await service.list()
    expect(listed.map((review) => review.id)).toEqual([second.id, first.id])
  })

  it('returns nothing before any review exists', async () => {
    await expect(service.list()).resolves.toEqual([])
  })
})
