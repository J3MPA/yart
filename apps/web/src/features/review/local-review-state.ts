import type { Attachment, DiffSide } from '@yart/core'

interface DraftBase {
  id: string
  body: string
  /** The images, already on the daemon. Not there on drafts from before images existed. */
  attachments?: Attachment[]
  created_at: string
}

/** A comment on a line, held for the pending review. */
export interface ThreadDraft extends DraftBase {
  kind: 'thread'
  path: string
  side: DiffSide
  line: number
  /**
   * The blob of the line number.
   *
   * This is for each file, not for each head of the review. A new round that
   * does not change this file does not change what the line means. The
   * reviewer must not lose a comment that they already wrote.
   */
  blob_sha: string
}

/** A reply held for the pending review, to a thread that was already sent. */
export interface ReplyDraft extends DraftBase {
  kind: 'reply'
  thread_id: string
}

export type Draft = ThreadDraft | ReplyDraft

/**
 * The work state of one person on one review.
 *
 * The browser keeps it, with the other state of each person. Thus an agent that
 * reads the review through `get_review` never sees a comment that its author did
 * not send. A directory that you fold on one computer stays open on a different
 * computer.
 */
export interface LocalReviewState {
  /** The paths of the folded directories in the file tree. */
  folded: readonly string[]
  /**
   * The files marked as reviewed, each with the blob of the review.
   *
   * The key is the blob. Thus a file that the agent changes later stops counting
   * as reviewed. A mark that stays after its code changed would be incorrect.
   */
  reviewed: Readonly<Record<string, string>>
  drafts: readonly Draft[]
}

export type LocalReviews = Readonly<Record<string, LocalReviewState>>

export const EMPTY_LOCAL: LocalReviewState = { folded: [], reviewed: {}, drafts: [] }

export const localFor = (state: LocalReviews, review_id: string): LocalReviewState =>
  state[review_id] ?? EMPTY_LOCAL

const withLocal = (
  state: LocalReviews,
  review_id: string,
  update: (local: LocalReviewState) => LocalReviewState,
): LocalReviews => ({ ...state, [review_id]: update(localFor(state, review_id)) })

export const toggleFolded = (state: LocalReviews, review_id: string, path: string): LocalReviews =>
  withLocal(state, review_id, (local) => ({
    ...local,
    folded: local.folded.includes(path)
      ? local.folded.filter((folded) => folded !== path)
      : [...local.folded, path],
  }))

/** Marks a file as reviewed at a blob, or removes the mark when the blob is null. */
export const setReviewed = (
  state: LocalReviews,
  review_id: string,
  path: string,
  blob_sha: string | null,
): LocalReviews =>
  withLocal(state, review_id, (local) => {
    const reviewed = { ...local.reviewed }
    if (blob_sha === null) delete reviewed[path]
    else reviewed[path] = blob_sha
    return { ...local, reviewed }
  })

/** Tells if a file is reviewed as it is now, not only as it was before. */
export const isReviewed = (local: LocalReviewState, path: string, blob_sha: string): boolean =>
  local.reviewed[path] === blob_sha

export const addDraft = (state: LocalReviews, review_id: string, draft: Draft): LocalReviews =>
  withLocal(state, review_id, (local) => ({ ...local, drafts: [...local.drafts, draft] }))

export const updateDraft = (
  state: LocalReviews,
  review_id: string,
  draft_id: string,
  body: string,
  attachments: Attachment[] = [],
): LocalReviews =>
  withLocal(state, review_id, (local) => ({
    ...local,
    drafts: local.drafts.map((draft) =>
      draft.id === draft_id ? { ...draft, body, attachments } : draft,
    ),
  }))

export const removeDraft = (
  state: LocalReviews,
  review_id: string,
  draft_id: string,
): LocalReviews =>
  withLocal(state, review_id, (local) => ({
    ...local,
    drafts: local.drafts.filter((draft) => draft.id !== draft_id),
  }))

export const clearDrafts = (state: LocalReviews, review_id: string): LocalReviews =>
  withLocal(state, review_id, (local) => ({ ...local, drafts: [] }))

/**
 * Removes the state of reviews that do not exist now.
 *
 * Always give it the ids of all reviews, archived reviews included. With only
 * the active list, it would remove the drafts of a review when it was archived.
 */
export const forgetDeleted = (state: LocalReviews, live_ids: Iterable<string>): LocalReviews => {
  const live = new Set(live_ids)
  const kept: Record<string, LocalReviewState> = {}
  for (const [id, local] of Object.entries(state)) {
    if (live.has(id)) kept[id] = local
  }
  return kept
}

/**
 * The blob of the review mark of a file: its head, or its base when the file was
 * deleted.
 *
 * Null only for a file with neither. Such a file has nothing to read.
 */
export const reviewBlob = (file: {
  head_blob_sha: string | null
  base_blob_sha: string | null
}): string | null => file.head_blob_sha ?? file.base_blob_sha
