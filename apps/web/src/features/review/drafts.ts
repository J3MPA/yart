import type { DiffSide, ReviewFile } from '@yart/core'
import type { Draft, ReplyDraft, ThreadDraft } from './local-review-state'
import { anchorKey } from './thread-anchors'

/**
 * What a diff row or a thread needs to write into the pending review. It is one
 * object, thus it goes down the tree as one prop.
 */
export interface Drafting {
  review_id: string
  /** Tells if a pending review started. This changes the text of the buttons. */
  in_progress: boolean
  /** The line comments that still apply. They have the same keys as threads, thus rows can find them. */
  by_anchor: ReadonlyMap<string, ThreadDraft[]>
  by_thread: ReadonlyMap<string, ReplyDraft[]>
}

export type FileBlobs = Pick<ReviewFile, 'head_blob_sha' | 'base_blob_sha'>

const blobOn = (file: FileBlobs, side: DiffSide): string | null =>
  side === 'head' ? file.head_blob_sha : file.base_blob_sha

/**
 * Tells if the line number of a draft is still correct.
 *
 * The line of a comment is for one version of one file. Thus it stays correct
 * for as long as that file does not change, through all rounds that change
 * other files. A reply has no risk. It belongs to a thread, and threads get a
 * new anchor when the review moves.
 */
export const isStale = (draft: Draft, files: ReadonlyMap<string, FileBlobs>): boolean => {
  if (draft.kind === 'reply') return false
  const file = files.get(draft.path)
  return file === undefined || blobOn(file, draft.side) !== draft.blob_sha
}

/**
 * Sorts drafts by the place where they show.
 *
 * A stale line comment has no place in the diff. At its old line number on a
 * changed file, it would be next to code that it is not about. It stays in the
 * pending list, where you can read it and remove it.
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
