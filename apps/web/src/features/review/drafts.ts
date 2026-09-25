import type { DiffSide, ReviewFile } from '@yart/core'
import type { Draft, ReplyDraft, ThreadDraft } from './local-review-state'
import { anchorKey } from './thread-anchors'

/**
 * What a diff row or thread needs to write into the pending review, gathered
 * so it travels down the tree as one prop.
 */
export interface Drafting {
  review_id: string
  /** Whether a pending review has been started, which changes what the buttons say. */
  in_progress: boolean
  /** Line comments that still apply, keyed like threads so rows can find theirs. */
  by_anchor: ReadonlyMap<string, ThreadDraft[]>
  by_thread: ReadonlyMap<string, ReplyDraft[]>
}

export type FileBlobs = Pick<ReviewFile, 'head_blob_sha' | 'base_blob_sha'>

const blobOn = (file: FileBlobs, side: DiffSide): string | null =>
  side === 'head' ? file.head_blob_sha : file.base_blob_sha

/**
 * Whether a draft's line number still means anything.
 *
 * A line comment was counted against one version of one file, so it stays good
 * for exactly as long as that file does — through any number of rounds that
 * touch other files. A reply is never at risk: it belongs to a thread, and
 * threads are re-anchored when the review moves.
 */
export const isStale = (draft: Draft, files: ReadonlyMap<string, FileBlobs>): boolean => {
  if (draft.kind === 'reply') return false
  const file = files.get(draft.path)
  return file === undefined || blobOn(file, draft.side) !== draft.blob_sha
}

/**
 * Sorts drafts into where they are drawn.
 *
 * A stale line comment goes nowhere in the diff: drawn at its old line number
 * on a changed file, it would sit beside code it was never about. It stays in
 * the pending list instead, where it can be read and dropped.
 */
export const groupDrafts = (
  drafts: readonly Draft[],
  files: ReadonlyMap<string, FileBlobs>,
): Pick<Drafting, 'by_anchor' | 'by_thread'> => {
  const by_anchor = new Map<string, ThreadDraft[]>()
  const by_thread = new Map<string, ReplyDraft[]>()

  for (const draft of drafts) {
    if (isStale(draft, files)) continue
    if (draft.kind === 'thread') {
      const key = anchorKey(draft.path, draft.side, draft.line)
      by_anchor.set(key, [...(by_anchor.get(key) ?? []), draft])
    } else {
      by_thread.set(draft.thread_id, [...(by_thread.get(draft.thread_id) ?? []), draft])
    }
  }

  return { by_anchor, by_thread }
}

const now = (): string => new Date().toISOString()

export const newThreadDraft = (
  target: { path: string; side: DiffSide; line: number; blob_sha: string },
  body: string,
): ThreadDraft => ({
  id: crypto.randomUUID(),
  kind: 'thread',
  ...target,
  body,
  created_at: now(),
})

export const newReplyDraft = (thread_id: string, body: string): ReplyDraft => ({
  id: crypto.randomUUID(),
  kind: 'reply',
  thread_id,
  body,
  created_at: now(),
})

/** What a draft is about, in a few words, for the pending list. */
export const describeDraft = (draft: Draft): string =>
  draft.kind === 'thread'
    ? `${draft.path}:${draft.line}${draft.side === 'base' ? ' (old)' : ''}`
    : 'reply'
