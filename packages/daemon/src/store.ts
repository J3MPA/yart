import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { findGitCommonDir } from './git.ts'
import { checkInside, checkReviewId, isReviewId } from './review-id.ts'
import { writeFileAtomic } from './serial.ts'
import type { Review } from './types.ts'

/**
 * Reviews are in the git directory of the repository, not in the working tree.
 *
 * They are the state of one repository, and nobody wants to see them in
 * `git status`. Also, no diff that yart shows includes the git directory.
 *
 * This function asks git for the shared directory. It does not make the path
 * from `.git`, because in a linked worktree `.git` is a file, not a directory.
 */
export const storeDir = async (repo_path: string): Promise<string> =>
  join(await findGitCommonDir(repo_path), 'yart', 'reviews')

/**
 * The temporary title of a review from before titles existed.
 *
 * The service uses it to find such a review, and replaces it with a title that
 * a person can read. The store itself does not use git.
 */
export const placeholderTitle = (review: Review): string =>
  `${review.base_sha.slice(0, 8)}..${review.head_sha.slice(0, 8)}`

/**
 * Gives values to the fields that were added after a review was written.
 *
 * Reviews are local state that stays for a long time. Thus an older file must
 * still open. It must not cause a crash of the list that shows it.
 */
const withDefaults = (review: Review): Review => ({
  ...review,
  title: review.title ?? placeholderTitle(review),
  head_branch: review.head_branch ?? null,
  // Reviews from before replies to a verdict existed have no list of replies,
  // and nothing else adds one.
  submissions: (review.submissions ?? []).map((submission) => ({
    ...submission,
    comments: submission.comments ?? [],
  })),
  archived_at: review.archived_at ?? null,
  head_is_snapshot: review.head_is_snapshot ?? false,
})

/** Tells if a parsed file has the fields that the list and the pages read. */
const hasReviewShape = (review: Review): boolean =>
  typeof review.id === 'string' &&
  typeof review.created_at === 'string' &&
  typeof review.base_sha === 'string' &&
  typeof review.head_sha === 'string' &&
  Array.isArray(review.files) &&
  Array.isArray(review.threads)

export class ReviewStore {
  private readonly repo_path: string
  /** Found one time. A repository does not move while the daemon runs. */
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
    const dir = await this.dir()
    return checkInside(dir, join(dir, `${checkReviewId(id)}.json`))
  }

  async save(review: Review): Promise<void> {
    await mkdir(await this.dir(), { recursive: true })
    // Write the full review, not a part of it. A review is small. A partial write
    // would leave threads that point to a revision that the file does not record.
    // The rename makes sure that a reader at the same time never sees half a file.
    await writeFileAtomic(await this.pathFor(review.id), `${JSON.stringify(review, null, 2)}\n`)
  }

  async load(id: string): Promise<Review | null> {
    if (!isReviewId(id)) return null
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

    // One file that cannot be read must not stop the list. The list of all
    // repositories comes from these lists, thus one bad file would hide each
    // review of each repository. The daemon logs the file, and skips it.
    const dir = await this.dir()
    const reviews = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => entry.slice(0, -'.json'.length))
        .filter((id) => isReviewId(id))
        .map(async (id) => {
          const path = join(dir, `${id}.json`)
          try {
            const review = await this.load(id)
            if (review !== null && !hasReviewShape(review)) {
              throw new Error('it does not have the fields of a review')
            }
            return review
          } catch (cause) {
            console.error(
              `yart: skipped ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
            return null
          }
        }),
    )

    return reviews
      .filter((review): review is Review => review !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }

  async remove(id: string): Promise<void> {
    await rm(await this.pathFor(id), { force: true })
  }
}
