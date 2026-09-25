import type { DiffSide } from '@yart/core'

interface DraftBase {
  id: string
  body: string
  created_at: string
}

/** A line comment held for the pending review. */
export interface ThreadDraft extends DraftBase {
  kind: 'thread'
  path: string
  side: DiffSide
  line: number
  /**
   * The blob the line number was counted in.
   *
   * Per file rather than per review head: a new round that leaves this file
   * alone leaves the line meaning what it meant, and should not cost the
   * reviewer a comment they already wrote.
   */
  blob_sha: string
}

/** A reply held for the pending review, to a thread that has already been sent. */
export interface ReplyDraft extends DraftBase {
  kind: 'reply'
  thread_id: string
}

export type Draft = ThreadDraft | ReplyDraft

/**
 * One person's working state on one review.
 *
 * Kept in the browser with the rest of what is per person, so an agent reading
 * the review through `get_review` never sees a comment its author has not sent,
 * and a directory folded on one machine stays open on another.
 */
export interface LocalReviewState {
  /** Directory paths folded away in the file tree. */
  folded: readonly string[]
  /**
   * Files marked reviewed, each against the blob it was reviewed at.
   *
   * Keyed on the blob so a file the agent changes afterwards stops counting as
   * reviewed on its own: a tick that outlived the code it was given for would
   * say something untrue.
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

/** Marks a file reviewed at a blob, or clears the mark when the blob is null. */
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

/** Whether a file is reviewed as it stands now, not merely as it once was. */
export const isReviewed = (local: LocalReviewState, path: string, blob_sha: string): boolean =>
  local.reviewed[path] === blob_sha

export const addDraft = (state: LocalReviews, review_id: string, draft: Draft): LocalReviews =>
  withLocal(state, review_id, (local) => ({ ...local, drafts: [...local.drafts, draft] }))

export const updateDraft = (
  state: LocalReviews,
  review_id: string,
  draft_id: string,
  body: string,
): LocalReviews =>
  withLocal(state, review_id, (local) => ({
    ...local,
    drafts: local.drafts.map((draft) => (draft.id === draft_id ? { ...draft, body } : draft)),
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
 * Drops the state of reviews that no longer exist.
 *
 * Only ever given the ids of every review, archived ones included: pruning
 * against the active list alone would throw away the drafts on a review the
 * moment it was archived.
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
 * The blob a file is reviewed against: its head, or its base when deleted.
 *
 * Null only for a file with neither, which has nothing in it to have read.
 */
export const reviewBlob = (file: {
  head_blob_sha: string | null
  base_blob_sha: string | null
}): string | null => file.head_blob_sha ?? file.base_blob_sha
