import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findGitCommonDir } from './git.ts'
import { ReviewService } from './review.ts'
import { storeDir } from './store.ts'
import { TestRepo } from './test-repo.ts'

let repo: TestRepo
let worktree: string

const commitIn = (path: string, message: string) => {
  execFileSync('git', ['add', '-A'], { cwd: path })
  execFileSync('git', ['commit', '--quiet', '--no-gpg-sign', '-m', message], { cwd: path })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).trim()
}

beforeEach(() => {
  repo = new TestRepo()
  repo.write('a.txt', 'one\ntwo\n')
  repo.commit('base')
  worktree = repo.addWorktree('feature')
})

afterEach(() => {
  repo.dispose()
})

describe('a linked worktree', () => {
  it('has a .git file rather than a directory, which is the whole problem', () => {
    expect(existsSync(join(worktree, '.git'))).toBe(true)
    // Joining a path under this would fail with ENOTDIR.
    expect(existsSync(join(worktree, '.git', 'config'))).toBe(false)
  })

  it('resolves to the repository shared git directory', async () => {
    const from_worktree = await findGitCommonDir(worktree)
    const from_main = await findGitCommonDir(repo.path)
    expect(from_worktree).toBe(from_main)
  })

  it('stores reviews under that shared directory, not under the worktree', async () => {
    const dir = await storeDir(worktree)
    expect(dir.startsWith(worktree)).toBe(false)
    expect(dir).toBe(join(await findGitCommonDir(repo.path), 'yart', 'reviews'))
  })
})

describe('reviewing from a worktree', () => {
  it('opens a review without failing', async () => {
    writeFileSync(join(worktree, 'a.txt'), 'one\nCHANGED\n')
    const head = commitIn(worktree, 'change it')

    const service = new ReviewService(worktree)
    const review = await service.create({ repo_path: worktree, base: `${head}~1`, head })

    expect(review.files.map((file) => file.path)).toEqual(['a.txt'])
    expect(review.repo_path).toBe(worktree)
  })

  it('shows that review from the main worktree too, since the store is shared', async () => {
    writeFileSync(join(worktree, 'a.txt'), 'one\nCHANGED\n')
    const head = commitIn(worktree, 'change it')

    const from_worktree = new ReviewService(worktree)
    const created = await from_worktree.create({ repo_path: worktree, base: `${head}~1`, head })

    const from_main = new ReviewService(repo.path)
    const listed = await from_main.list()
    expect(listed.map((review) => review.id)).toContain(created.id)
  })

  it('remembers which worktree each review belongs to', async () => {
    writeFileSync(join(worktree, 'a.txt'), 'one\nCHANGED\n')
    const worktree_head = commitIn(worktree, 'change in worktree')
    await new ReviewService(worktree).create({
      repo_path: worktree,
      base: `${worktree_head}~1`,
      head: worktree_head,
    })

    repo.write('a.txt', 'one\ntwo\nthree\n')
    const main_head = repo.commit('change in main')
    await new ReviewService(repo.path).create({
      repo_path: repo.path,
      base: `${main_head}~1`,
      head: main_head,
    })

    const paths = (await new ReviewService(repo.path).list()).map((review) => review.repo_path)
    expect(paths).toContain(worktree)
    expect(paths).toContain(repo.path)
  })

  it('leaves the worktree clean', async () => {
    writeFileSync(join(worktree, 'a.txt'), 'one\nCHANGED\n')
    const head = commitIn(worktree, 'change it')
    await new ReviewService(worktree).create({ repo_path: worktree, base: `${head}~1`, head })

    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: worktree,
      encoding: 'utf8',
    })
    expect(status.trim()).toBe('')
  })
})
