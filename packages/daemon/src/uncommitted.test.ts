import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { objectType, snapshotWorkingTree } from './git.ts'
import { ReviewService, WORKING_TREE } from './review.ts'
import { TestRepo } from './test-repo.ts'

let repo: TestRepo
let service: ReviewService

const gitIn = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo.path, encoding: 'utf8' }).trim()

beforeEach(() => {
  repo = new TestRepo()
  repo.write('a.txt', 'one\ntwo\nthree\n')
  repo.commit('base')
  service = new ReviewService(repo.path)
})

afterEach(() => {
  repo.dispose()
})

describe('snapshotWorkingTree', () => {
  it('captures a modified file', async () => {
    repo.write('a.txt', 'one\nCHANGED\nthree\n')
    const tree = await snapshotWorkingTree(repo.path)
    expect(await objectType(repo.path, tree)).toBe('tree')
    expect(gitIn('show', `${tree}:a.txt`)).toContain('CHANGED')
  })

  it('captures a file git is not tracking at all', async () => {
    repo.write('brand-new.txt', 'hello\n')
    const tree = await snapshotWorkingTree(repo.path)
    expect(gitIn('ls-tree', tree, '--', 'brand-new.txt')).not.toBe('')
  })

  it('leaves the staging area exactly as it was', async () => {
    repo.write('a.txt', 'one\nCHANGED\nthree\n')
    const before = gitIn('status', '--porcelain')
    await snapshotWorkingTree(repo.path)
    expect(gitIn('status', '--porcelain')).toBe(before)
  })

  it('produces real blob hashes, which is what comments anchor to', async () => {
    repo.write('brand-new.txt', 'hello\n')
    const tree = await snapshotWorkingTree(repo.path)
    const raw = gitIn('diff', '--raw', '--abbrev=40', 'HEAD', tree)
    const new_side = raw.split(/\s+/)[3] as string
    expect(new_side).not.toMatch(/^0+$/)
    expect(await objectType(repo.path, new_side)).toBe('blob')
  })
})

describe('reviewing uncommitted work', () => {
  it('reviews an untracked file, which has no revision to name', async () => {
    repo.write('brand-new.txt', 'hello\nworld\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })

    expect(review.head_is_snapshot).toBe(true)
    expect(review.files.map((file) => file.path)).toEqual(['brand-new.txt'])
    expect(review.files[0]?.status).toBe('added')
  })

  it('anchors a comment to uncommitted content', async () => {
    repo.write('brand-new.txt', 'hello\nworld\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })
    const with_thread = await service.addThread(review.id, {
      path: 'brand-new.txt',
      line: 2,
      body: 'why world?',
    })

    expect(with_thread.threads[0]?.context.line).toBe('world')
    expect(with_thread.threads[0]?.anchor_state).toBe('current')
  })

  it('keeps the snapshot reachable so its blobs cannot be collected', async () => {
    repo.write('brand-new.txt', 'hello\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })

    expect(gitIn('rev-parse', `refs/yart/reviews/${review.id}`)).toBe(review.head_sha)
    // Aggressive pruning must not reap a pinned snapshot.
    gitIn('gc', '--prune=now', '--quiet')
    expect(await objectType(repo.path, review.head_sha)).toBe('tree')
  })

  it('re-snapshots on advance, without needing a commit', async () => {
    repo.write('brand-new.txt', 'hello\nworld\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })
    await service.addThread(review.id, { path: 'brand-new.txt', line: 2, body: 'look' })

    // The agent edits again, still without committing.
    writeFileSync(join(repo.path, 'brand-new.txt'), 'an import\nhello\nworld\n')
    const advanced = await service.advanceHead(review.id)

    expect(advanced.head_is_snapshot).toBe(true)
    expect(advanced.head_sha).not.toBe(review.head_sha)
    expect(advanced.threads[0]?.anchor?.line).toBe(3)
    expect(advanced.threads[0]?.anchor_state).toBe('shifted')
  })

  it('outdates a comment whose uncommitted line was rewritten', async () => {
    repo.write('brand-new.txt', 'hello\nworld\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })
    await service.addThread(review.id, { path: 'brand-new.txt', line: 2, body: 'look' })

    writeFileSync(join(repo.path, 'brand-new.txt'), 'hello\nREWRITTEN\n')
    const advanced = await service.advanceHead(review.id)

    expect(advanced.threads[0]?.anchor_state).toBe('outdated')
    expect(advanced.threads[0]?.context.line).toBe('world')
  })

  it('releases the snapshot when the review is deleted', async () => {
    repo.write('brand-new.txt', 'hello\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })
    await service.remove(review.id)

    expect(() => gitIn('rev-parse', '--verify', `refs/yart/reviews/${review.id}`)).toThrow()
  })

  it('titles a snapshot review honestly rather than after the last commit', async () => {
    repo.write('brand-new.txt', 'hello\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })
    expect(review.title).toBe('Uncommitted changes')
  })

  it('still reviews committed work when given a revision', async () => {
    repo.write('a.txt', 'one\nCOMMITTED\nthree\n')
    const head = repo.commit('a committed change')
    const review = await service.create({ repo_path: repo.path, base: `${head}~1`, head })

    expect(review.head_is_snapshot).toBe(false)
    expect(review.title).toBe('a committed change')
  })

  it('reports an empty snapshot review rather than inventing changes', async () => {
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })
    expect(review.files).toEqual([])
  })

  it('knows whether there is uncommitted work at all', async () => {
    await expect(service.hasUncommittedWork()).resolves.toBe(false)
    repo.write('brand-new.txt', 'hello\n')
    await expect(service.hasUncommittedWork()).resolves.toBe(true)
  })
})

describe('trees as review endpoints', () => {
  it('accepts a bare tree hash, which has no commit to name it', async () => {
    repo.write('a.txt', 'one\nCHANGED\nthree\n')
    const tree = await snapshotWorkingTree(repo.path)
    const review = await service.create({
      repo_path: repo.path,
      base: 'HEAD',
      head: tree,
      title: 'tree to tree',
    })
    expect(review.head_sha).toBe(tree)
    expect(review.files.map((file) => file.path)).toEqual(['a.txt'])
  })

  it('refuses an object that is neither a commit nor a tree', async () => {
    const blob = gitIn('rev-parse', 'HEAD:a.txt')
    await expect(
      service.create({ repo_path: repo.path, base: 'HEAD', head: blob }),
    ).rejects.toThrow(/commit or a tree/)
  })
})

describe('WORKING_TREE', () => {
  it('is what head defaults to', async () => {
    repo.write('brand-new.txt', 'hello\n')
    const review = await service.create({ repo_path: repo.path, base: 'HEAD' })
    expect(review.head).toBe(WORKING_TREE)
  })
})
