import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Review } from './types.ts'

/**
 * Reviews live under `.git/` rather than in the working tree.
 *
 * They are per-repository state that no one wants to see in `git status`, and
 * `.git/` is already excluded from every diff yart will ever show.
 */
export const storeDir = (repo_path: string): string => {
  return join(repo_path, '.git', 'yart', 'reviews')
}

/**
 * The placeholder title a review written before titles existed gets.
 *
 * Exported so the service can recognise it and replace it with something a
 * person would actually read; the store itself does no git.
 */
export const placeholderTitle = (review: Review): string =>
  `${review.base_sha.slice(0, 8)}..${review.head_sha.slice(0, 8)}`

/**
 * Fills in fields added after a review was written.
 *
 * Reviews are long-lived local state, so an older file has to keep opening
 * rather than crash the list it appears in.
 */
const withDefaults = (review: Review): Review => ({
  ...review,
  title: review.title ?? placeholderTitle(review),
  head_branch: review.head_branch ?? null,
  submissions: review.submissions ?? [],
})

export class ReviewStore {
  private readonly repo_path: string

  constructor(repo_path: string) {
    this.repo_path = repo_path
  }

  private pathFor(id: string): string {
    return join(storeDir(this.repo_path), `${id}.json`)
  }

  async save(review: Review): Promise<void> {
    await mkdir(storeDir(this.repo_path), { recursive: true })
    // Written whole rather than patched: a review is small, and a partial write
    // would leave threads pointing at a revision the file no longer records.
    await writeFile(this.pathFor(review.id), `${JSON.stringify(review, null, 2)}\n`, 'utf8')
  }

  async load(id: string): Promise<Review | null> {
    try {
      const raw = await readFile(this.pathFor(id), 'utf8')
      return withDefaults(JSON.parse(raw) as Review)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw cause
    }
  }

  async list(): Promise<Review[]> {
    let entries: string[]
    try {
      entries = await readdir(storeDir(this.repo_path))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw cause
    }

    const reviews = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => this.load(entry.slice(0, -'.json'.length))),
    )

    return reviews
      .filter((review): review is Review => review !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }

  async remove(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true })
  }
}
