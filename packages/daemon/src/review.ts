import { randomUUID } from 'node:crypto'
import {
  createThread,
  reanchorThread,
  type Comment,
  type CommentAuthor,
  type DiffSide,
  type FileResolution,
  type LineMap,
  type Thread,
} from '@yart/core'
import {
  branchAt,
  buildLineMapFromGit,
  commitSubject,
  listChangedFiles,
  readBlob,
  resolveRev,
  type ChangedFile,
} from './git.ts'
import { placeholderTitle, ReviewStore } from './store.ts'
import type { Review, ReviewFile, ReviewSubmission, ReviewVerdict } from './types.ts'

export class ReviewError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ReviewError'
    this.status = status
  }
}

const nowIso = (): string => {
  return new Date().toISOString()
}

const toReviewFile = (change: ChangedFile): ReviewFile => {
  return {
    status: change.status,
    path: change.path,
    old_path: change.old_path,
    base_blob_sha: change.base_blob_sha,
    head_blob_sha: change.head_blob_sha,
  }
}

export interface CreateReviewParams {
  repo_path: string
  base: string
  head?: string
  /** Overrides the default, which is the head commit's subject. */
  title?: string
}

/**
 * Names a review for a person scanning a list of them.
 *
 * The head commit's subject is almost always what the review is about, and it
 * is already written; falling back to an abbreviated range at least stays
 * stable, which `main..HEAD` does not.
 */
const deriveTitle = async (repo_path: string, head_sha: string, base_sha: string) =>
  (await commitSubject(repo_path, head_sha)) ?? `${base_sha.slice(0, 8)}..${head_sha.slice(0, 8)}`

export interface SubmitParams {
  verdict?: ReviewVerdict
  body?: string | null
}

export interface AddThreadParams {
  path: string
  line: number
  side?: DiffSide
  body: string
  author?: CommentAuthor
}

export class ReviewService {
  private readonly repo_path: string
  private readonly store: ReviewStore

  constructor(repo_path: string) {
    this.repo_path = repo_path
    this.store = new ReviewStore(repo_path)
  }

  async create({ repo_path, base, head = 'HEAD', title }: CreateReviewParams): Promise<Review> {
    const [base_sha, head_sha] = await Promise.all([
      resolveRev(repo_path, base),
      resolveRev(repo_path, head),
    ])

    const [changes, head_branch, derived_title] = await Promise.all([
      listChangedFiles(repo_path, base_sha, head_sha),
      branchAt(repo_path, head_sha),
      deriveTitle(repo_path, head_sha, base_sha),
    ])
    const created_at = nowIso()

    const review: Review = {
      id: randomUUID(),
      repo_path,
      title: title ?? derived_title,
      head_branch,
      base,
      head,
      base_sha,
      head_sha,
      status: 'open',
      submissions: [],
      files: changes.map(toReviewFile),
      threads: [],
      rounds: [head_sha],
      created_at,
      updated_at: created_at,
    }

    await this.store.save(review)
    return review
  }

  async get(id: string): Promise<Review> {
    const review = await this.store.load(id)
    if (review === null) throw new ReviewError(`No review with id ${id}`, 404)
    return this.upgradeTitle(review)
  }

  async list(): Promise<Review[]> {
    return Promise.all((await this.store.list()).map((review) => this.upgradeTitle(review)))
  }

  /**
   * Replaces a placeholder title with the head commit's subject, once.
   *
   * Reviews written before titles existed would otherwise show a hash range
   * forever. The result is persisted so this costs one git call per review
   * rather than one per read.
   */
  private async upgradeTitle(review: Review): Promise<Review> {
    if (review.title !== placeholderTitle(review)) return review

    const subject = await commitSubject(review.repo_path, review.head_sha)
    if (subject === null) return review

    const upgraded: Review = {
      ...review,
      title: subject,
      head_branch: review.head_branch ?? (await branchAt(review.repo_path, review.head_sha)),
    }
    await this.store.save(upgraded)
    return upgraded
  }

  private async persist(review: Review): Promise<Review> {
    const updated: Review = { ...review, updated_at: nowIso() }
    await this.store.save(updated)
    return updated
  }

  async addThread(id: string, params: AddThreadParams): Promise<Review> {
    const review = await this.get(id)
    const { path, line, side = 'head', body, author = 'human' } = params

    const file = review.files.find((candidate) => candidate.path === path)
    if (file === undefined) {
      throw new ReviewError(`${path} is not part of this review`, 404)
    }

    const blob_sha = side === 'head' ? file.head_blob_sha : file.base_blob_sha
    if (blob_sha === null) {
      throw new ReviewError(`${path} has no ${side} revision to comment on`, 400)
    }

    const content = await readBlob(review.repo_path, blob_sha)
    const comment: Comment = {
      id: randomUUID(),
      author,
      body,
      created_at: nowIso(),
    }

    let thread: Thread
    try {
      thread = createThread({
        id: randomUUID(),
        anchor: { path, blob_sha, line, side },
        content,
        comment,
      })
    } catch (cause) {
      // createThread rejects a line outside the file; that is a bad request
      // rather than a server fault, so it is reported as one.
      if (cause instanceof RangeError) throw new ReviewError(cause.message, 400)
      throw cause
    }

    return this.persist({ ...review, threads: [...review.threads, thread] })
  }

  private async withThread(
    id: string,
    thread_id: string,
    update: (thread: Thread) => Thread,
  ): Promise<Review> {
    const review = await this.get(id)
    const index = review.threads.findIndex((thread) => thread.id === thread_id)
    if (index === -1) throw new ReviewError(`No thread with id ${thread_id}`, 404)

    const threads = [...review.threads]
    threads[index] = update(threads[index] as Thread)
    return this.persist({ ...review, threads })
  }

  async addComment(
    id: string,
    thread_id: string,
    body: string,
    author: CommentAuthor = 'human',
  ): Promise<Review> {
    const comment: Comment = { id: randomUUID(), author, body, created_at: nowIso() }
    return this.withThread(id, thread_id, (thread) => ({
      ...thread,
      comments: [...thread.comments, comment],
    }))
  }

  async setThreadStatus(id: string, thread_id: string, status: Thread['status']): Promise<Review> {
    return this.withThread(id, thread_id, (thread) => ({ ...thread, status }))
  }

  async submit(id: string, params: SubmitParams = {}): Promise<Review> {
    const review = await this.get(id)
    const { verdict = 'commented', body = null } = params

    const submission: ReviewSubmission = {
      id: randomUUID(),
      verdict,
      body: body === null || body.trim() === '' ? null : body.trim(),
      head_sha: review.head_sha,
      created_at: nowIso(),
    }

    return this.persist({
      ...review,
      status: 'submitted',
      submissions: [...review.submissions, submission],
    })
  }

  /**
   * Moves the review onto a newer head and re-anchors every thread onto it.
   *
   * Threads are re-anchored one at a time rather than through `reanchorThreads`
   * because that batch keys resolutions by blob hash alone, and two files with
   * identical content share a hash — so a single resolution could not describe
   * both. Line maps are cached here instead, which recovers the same saving.
   */
  async advanceHead(id: string, head: string): Promise<Review> {
    const review = await this.get(id)
    const head_sha = await resolveRev(review.repo_path, head)

    if (head_sha === review.head_sha) return review

    const [since_last, from_base] = await Promise.all([
      listChangedFiles(review.repo_path, review.head_sha, head_sha),
      listChangedFiles(review.repo_path, review.base_sha, head_sha),
    ])

    const by_old_path = new Map<string, ChangedFile>()
    for (const change of since_last) {
      by_old_path.set(change.old_path ?? change.path, change)
    }

    const line_maps = new Map<string, LineMap>()
    const threads: Thread[] = []

    for (const thread of review.threads) {
      const { anchor } = thread
      // The base side of the range never moves, so its anchors stay valid.
      if (anchor === null || anchor.side === 'base') {
        threads.push(thread)
        continue
      }

      const change = by_old_path.get(anchor.path)
      if (change === undefined) {
        threads.push(thread)
        continue
      }

      let resolution: FileResolution
      if (change.head_blob_sha === null) {
        resolution = { kind: 'deleted' }
      } else if (change.head_blob_sha === anchor.blob_sha) {
        resolution = { kind: 'unchanged', path: change.path }
      } else {
        const cache_key = `${anchor.blob_sha}..${change.head_blob_sha}`
        let line_map = line_maps.get(cache_key)
        if (line_map === undefined) {
          line_map = await buildLineMapFromGit(
            review.repo_path,
            anchor.blob_sha,
            change.head_blob_sha,
          )
          line_maps.set(cache_key, line_map)
        }
        resolution = {
          kind: 'modified',
          path: change.path,
          blob_sha: change.head_blob_sha,
          line_map,
        }
      }

      threads.push(reanchorThread(thread, resolution))
    }

    return this.persist({
      ...review,
      head,
      head_sha,
      head_branch: await branchAt(review.repo_path, head_sha),
      status: 'open',
      files: from_base.map(toReviewFile),
      threads,
      rounds: [...review.rounds, head_sha],
    })
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id)
  }

  get repoPath(): string {
    return this.repo_path
  }
}
