import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { findGitCommonDir } from './git.ts'
import type { Review } from './types.ts'

/**
 * Reviews live under the repository's git directory rather than in the working
 * tree.
 *
 * They are per-repository state that no one wants to see in `git status`, and
 * git's own directory is already excluded from every diff yart will show.
 *
 * The shared directory is asked of git rather than assembled from `.git`,
 * because in a linked worktree that is a file rather than a directory.
 */
export const storeDir = async (repo_path: string): Promise<string> =>
  join(await findGitCommonDir(repo_path), 'yart', 'reviews')

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
  // Reviews written before a submission could be replied to have no list to
  // append to, and nothing else would put one there.
  submissions: (review.submissions ?? []).map((submission) => ({
    ...submission,
    comments: submission.comments ?? [],
  })),
  archived_at: review.archived_at ?? null,
  head_is_snapshot: review.head_is_snapshot ?? false,
})

export class ReviewStore {
  private readonly repo_path: string
  /** Resolved once: a repository does not move while the daemon is running. */
  private resolved_dir: string | null

  constructor(repo_path: string) {
    this.repo_path = repo_path
    this.resolved_dir = null
  }

  private async dir(): Promise<string> {
    this.resolved_dir ??= await storeDir(this.repo_path)
    return this.resolved_dir
  }

  private async pathFor(id: string): Promise<string> {
    return join(await this.dir(), `${id}.json`)
  }

  async save(review: Review): Promise<void> {
    await mkdir(await this.dir(), { recursive: true })
    // Written whole rather than patched: a review is small, and a partial write
    // would leave threads pointing at a revision the file no longer records.
    await writeFile(await this.pathFor(review.id), `${JSON.stringify(review, null, 2)}\n`, 'utf8')
  }

  async load(id: string): Promise<Review | null> {
    try {
      const raw = await readFile(await this.pathFor(id), 'utf8')
      return withDefaults(JSON.parse(raw) as Review)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw cause
    }
  }

  async list(): Promise<Review[]> {
    let entries: string[]
    try {
      entries = await readdir(await this.dir())
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
    await rm(await this.pathFor(id), { force: true })
  }
}
