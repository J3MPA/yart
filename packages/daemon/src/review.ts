import { randomUUID } from 'node:crypto'
import {
  createThread,
  reanchorThread,
  type Attachment,
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
  isWorkingTreeDirty,
  listChangedFiles,
  pinSnapshot,
  readBlob,
  resolveRev,
  snapshotWorkingTree,
  unpinSnapshot,
  type ChangedFile,
} from './git.ts'
import { AttachmentStore } from './attachments.ts'
import { ReviewError } from './review-error.ts'
import { placeholderTitle, ReviewStore } from './store.ts'
import type {
  Review,
  ReviewFile,
  ReviewSubmission,
  ReviewVerdict,
  SubmissionAuthor,
} from './types.ts'

export { ReviewError }

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
  /** Replaces the default, which is the subject of the head commit. */
  title?: string
}

/**
 * Gives a review a name for a person who reads a list of reviews.
 *
 * The subject of the head commit is almost always what the review is about, and
 * it already exists. Without a commit, a short range is the name. It stays the
 * same, but `main..HEAD` does not.
 */
const deriveTitle = async (repo_path: string, head_sha: string, base_sha: string) =>
  (await commitSubject(repo_path, head_sha)) ?? `${base_sha.slice(0, 8)}..${head_sha.slice(0, 8)}`

interface ResolvedHead {
  sha: string
  is_snapshot: boolean
}

/** Finds the head of a review. It makes a snapshot of the working tree when the request asks. */
const resolveHead = async (
  repo_path: string,
  head: string,
  review_id: string,
): Promise<ResolvedHead> => {
  if (head !== WORKING_TREE) {
    return { sha: await resolveRev(repo_path, head), is_snapshot: false }
  }

  const tree_sha = await snapshotWorkingTree(repo_path)
  await pinSnapshot(repo_path, review_id, tree_sha)
  return { sha: tree_sha, is_snapshot: true }
}

/**
 * Names the working tree as one end of a review.
 *
 * An agent finishes its work before it commits anything. Thus a review must be
 * able to point to what is on the disk, not only to the history.
 */
export const WORKING_TREE = 'working'

export interface ListReviewsParams {
  /** Return the archived reviews, not the active reviews. */
  archived?: boolean
}

/** A comment on a line in a pending review. It is not a thread yet. */
export interface DraftThread {
  path: string
  line: number
  side?: DiffSide
  body: string
  /** The ids of images that the review already has. */
  attachments?: readonly string[]
  /**
   * The blob of the line number, when the writer of the draft knows it.
   *
   * The service compares it with the file as it is now, because a draft can stay
   * through many rounds. A new head of the review says nothing about this one
   * file. But a new blob of this file means that the line can point to a
   * different place.
   */
  blob_sha?: string
}

/** A reply in a pending review, to a thread that already exists. */
export interface DraftReply {
  thread_id: string
  body: string
  attachments?: readonly string[]
}

export interface SubmitParams {
  verdict?: ReviewVerdict
  /** Who gives the verdict. The held comments also belong to this author. */
  author?: SubmissionAuthor
  author_name?: string | null
  body?: string | null
  /** The images of the summary. */
  attachments?: readonly string[]
  threads?: readonly DraftThread[]
  replies?: readonly DraftReply[]
  /**
   * The head that the submitter looked at.
   *
   * If this head is given and is not current, the service refuses the
   * submission. The line numbers of the drafts are for that head. A verdict on
   * it says nothing about code that the submitter did not see.
   */
  expected_head_sha?: string
}

export interface AddThreadParams {
  path: string
  line: number
  side?: DiffSide
  body: string
  author?: CommentAuthor
  author_name?: string | null
  attachments?: readonly string[]
}

/** Who writes a comment, and the ids of its images. */
export interface CommentOptions {
  author?: CommentAuthor
  author_name?: string | null
  attachments?: readonly string[]
}

/** A comment. It has the name of a reviewer and images only when there are some. */
const newComment = (
  body: string,
  author: CommentAuthor,
  author_name: string | null = null,
  attachments: readonly Attachment[] = [],
): Comment => ({
  id: randomUUID(),
  author,
  ...(author_name === null ? {} : { author_name }),
  body,
  ...(attachments.length === 0 ? {} : { attachments: [...attachments] }),
  created_at: nowIso(),
})

export class ReviewService {
  private readonly repo_path: string
  private readonly store: ReviewStore
  private readonly attachments: AttachmentStore

  constructor(repo_path: string) {
    this.repo_path = repo_path
    this.store = new ReviewStore(repo_path)
    this.attachments = new AttachmentStore(repo_path)
  }

  /** Keeps an image for the comments of a review. */
  async addAttachment(id: string, data: Uint8Array): Promise<Attachment> {
    await this.get(id)
    return this.attachments.save(id, data)
  }

  async readAttachment(id: string, attachment_id: string) {
    return this.attachments.read(id, attachment_id)
  }

  async create({
    repo_path,
    base,
    head = WORKING_TREE,
    title,
  }: CreateReviewParams): Promise<Review> {
    const id = randomUUID()
    const base_sha = await resolveRev(repo_path, base)
    const resolved_head = await resolveHead(repo_path, head, id)
    const head_sha = resolved_head.sha

    const [changes, head_branch, derived_title] = await Promise.all([
      listChangedFiles(repo_path, base_sha, head_sha),
      branchAt(repo_path, resolved_head.is_snapshot ? 'HEAD' : head_sha),
      resolved_head.is_snapshot
        ? Promise.resolve('Uncommitted changes')
        : deriveTitle(repo_path, head_sha, base_sha),
    ])
    const created_at = nowIso()

    const review: Review = {
      id,
      repo_path,
      title: title ?? derived_title,
      head_branch,
      head_is_snapshot: resolved_head.is_snapshot,
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
      archived_at: null,
    }

    await this.store.save(review)
    return review
  }

  async get(id: string): Promise<Review> {
    const review = await this.store.load(id)
    if (review === null) throw new ReviewError(`No review with id ${id}`, 404)
    return this.upgradeTitle(review)
  }

  async list({ archived = false }: ListReviewsParams = {}): Promise<Review[]> {
    const all = await Promise.all(
      (await this.store.list()).map((review) => this.upgradeTitle(review)),
    )
    return all.filter((review) => (review.archived_at !== null) === archived)
  }

  /**
   * Replaces a temporary title with the subject of the head commit, one time.
   *
   * Without this, reviews from before titles existed would always show a hash
   * range. The service saves the result. Thus this costs one git call for each
   * review, not one for each read.
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
    const thread = await this.buildThread(review, params)
    return this.persist({ ...review, threads: [...review.threads, thread] })
  }

  /** Finds the line of a comment in the review, and keeps its context. */
  private async buildThread(review: Review, params: AddThreadParams): Promise<Thread> {
    const {
      path,
      line,
      side = 'head',
      body,
      author = 'human',
      author_name = null,
      attachments: attachment_ids,
    } = params

    const file = review.files.find((candidate) => candidate.path === path)
    if (file === undefined) {
      throw new ReviewError(`${path} is not part of this review`, 404)
    }

    const blob_sha = side === 'head' ? file.head_blob_sha : file.base_blob_sha
    if (blob_sha === null) {
      throw new ReviewError(`${path} has no ${side} revision to comment on`, 400)
    }

    const content = await readBlob(review.repo_path, blob_sha)
    const attachments = await this.attachments.resolve(review.id, attachment_ids)
    const comment = newComment(body, author, author_name, attachments)

    try {
      return createThread({
        id: randomUUID(),
        anchor: { path, blob_sha, line, side },
        content,
        comment,
      })
    } catch (cause) {
      // createThread refuses a line that is not in the file. That is a bad
      // request, not a server fault. Thus the error tells it as a bad request.
      if (cause instanceof RangeError) throw new ReviewError(cause.message, 400)
      throw cause
    }
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
    { author = 'human', author_name = null, attachments }: CommentOptions = {},
  ): Promise<Review> {
    const resolved = await this.attachments.resolve(id, attachments)
    const comment = newComment(body, author, author_name, resolved)
    return this.withThread(id, thread_id, (thread) => ({
      ...thread,
      comments: [...thread.comments, comment],
    }))
  }

  async setThreadStatus(id: string, thread_id: string, status: Thread['status']): Promise<Review> {
    return this.withThread(id, thread_id, (thread) => ({ ...thread, status }))
  }

  /**
   * Adds a reply to a verdict.
   *
   * The reply goes to a submission by its id, not always to the latest. A review
   * that had many rounds has many verdicts, and a reply belongs to the verdict
   * that it answers.
   */
  async addSubmissionComment(
    id: string,
    submission_id: string,
    body: string,
    { author = 'human', author_name = null, attachments }: CommentOptions = {},
  ): Promise<Review> {
    const review = await this.get(id)
    const index = review.submissions.findIndex((submission) => submission.id === submission_id)
    if (index === -1) throw new ReviewError(`No submission with id ${submission_id}`, 404)

    const resolved = await this.attachments.resolve(id, attachments)
    const comment = newComment(body, author, author_name, resolved)
    const submissions = [...review.submissions]
    const submission = submissions[index] as ReviewSubmission
    submissions[index] = { ...submission, comments: [...submission.comments, comment] }

    return this.persist({ ...review, submissions })
  }

  /**
   * Gives the review back, with the comments that were held for it.
   *
   * The service writes all of it in one write, or none of it. A pending review
   * goes as one unit. Half a review, with some comments sent but no verdict,
   * would show the agent a review that its author did not complete.
   */
  async submit(id: string, params: SubmitParams = {}): Promise<Review> {
    const review = await this.get(id)
    const {
      verdict = 'commented',
      author = 'human',
      author_name = null,
      body = null,
      attachments: attachment_ids,
      threads: drafts = [],
      replies = [],
      expected_head_sha,
    } = params

    if (expected_head_sha !== undefined && expected_head_sha !== review.head_sha) {
      throw new ReviewError(
        'The review has moved on to a newer round since you loaded it. ' +
          'Reload to see what changed before submitting.',
        409,
      )
    }

    const threads = [...review.threads]
    for (const draft of drafts) {
      if (draft.blob_sha !== undefined) {
        const file = review.files.find((candidate) => candidate.path === draft.path)
        const current =
          (draft.side ?? 'head') === 'head' ? file?.head_blob_sha : file?.base_blob_sha
        if (current !== draft.blob_sha) {
          throw new ReviewError(
            `The comment on ${draft.path}:${draft.line} was written on a version of the file ` +
              'that has since changed, so its line may no longer be the one it was about.',
            409,
          )
        }
      }
      threads.push(await this.buildThread(review, { ...draft, author, author_name }))
    }

    for (const reply of replies) {
      const index = threads.findIndex((thread) => thread.id === reply.thread_id)
      if (index === -1) throw new ReviewError(`No thread with id ${reply.thread_id}`, 404)
      const thread = threads[index] as Thread
      const attachments = await this.attachments.resolve(id, reply.attachments)
      const comment = newComment(reply.body, author, author_name, attachments)
      threads[index] = { ...thread, comments: [...thread.comments, comment] }
    }

    const summary_attachments = await this.attachments.resolve(id, attachment_ids)
    const submission: ReviewSubmission = {
      id: randomUUID(),
      verdict,
      author,
      ...(author_name === null ? {} : { author_name }),
      body: body === null || body.trim() === '' ? null : body.trim(),
      ...(summary_attachments.length === 0 ? {} : { attachments: summary_attachments }),
      comments: [],
      head_sha: review.head_sha,
      created_at: nowIso(),
    }

    return this.persist({
      ...review,
      threads,
      status: 'submitted',
      submissions: [...review.submissions, submission],
    })
  }

  /**
   * Moves the review to a newer head, and attaches each thread to it again.
   *
   * The service attaches the threads one at a time, not with `reanchorThreads`.
   * That function uses only the blob hash as the key. Two files with the same
   * content have the same hash, thus one resolution could not describe the two.
   * The service keeps the line maps in a cache, which gives the same saving.
   */
  async advanceHead(id: string, head?: string): Promise<Review> {
    const review = await this.get(id)

    // A snapshot review makes a new snapshot, unless the request names a
    // revision. Only "the working tree now" moved.
    const target = head ?? (review.head_is_snapshot ? WORKING_TREE : 'HEAD')
    const is_snapshot = target === WORKING_TREE
    const head_sha = is_snapshot
      ? await snapshotWorkingTree(review.repo_path)
      : await resolveRev(review.repo_path, target)

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
      // The base side of the range never moves. Thus its anchors stay correct.
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

    // Pin the new snapshot after the line maps exist. Thus the old snapshot stays
    // reachable while the threads that point into it get their new anchors.
    if (is_snapshot) await pinSnapshot(review.repo_path, review.id, head_sha)

    return this.persist({
      ...review,
      head: target,
      head_sha,
      head_is_snapshot: is_snapshot,
      head_branch: await branchAt(review.repo_path, is_snapshot ? 'HEAD' : head_sha),
      status: 'open',
      files: from_base.map(toReviewFile),
      threads,
      rounds: [...review.rounds, head_sha],
    })
  }

  /**
   * An archived review keeps all its comments. Only the default list does not
   * show it. A deletion is the action that you cannot undo.
   */
  async setArchived(id: string, archived: boolean): Promise<Review> {
    const review = await this.get(id)
    if ((review.archived_at !== null) === archived) return review
    return this.persist({ ...review, archived_at: archived ? nowIso() : null })
  }

  async remove(id: string): Promise<void> {
    // The snapshot ref exists only to keep the blobs of this review.
    const review = await this.store.load(id)
    if (review !== null) await unpinSnapshot(review.repo_path, id)
    await this.store.remove(id)
    await this.attachments.removeAll(id)
  }

  /** Tells if the store of this repository keeps a review. */
  async holds(id: string): Promise<boolean> {
    return (await this.store.load(id)) !== null
  }

  /** Tells if there is uncommitted work for a snapshot to keep. */
  async hasUncommittedWork(): Promise<boolean> {
    return isWorkingTreeDirty(this.repo_path)
  }

  get repoPath(): string {
    return this.repo_path
  }
}
