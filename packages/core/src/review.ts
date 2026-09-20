import type { Thread } from './types.ts'

/**
 * The shapes the daemon sends over the wire.
 *
 * They live here, in the package with no I/O, because the browser needs them
 * too: if they lived beside the git and filesystem code that produces them,
 * importing a type would drag `node:fs` into the bundle.
 */

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'

export interface ReviewFile {
  status: ChangeStatus
  /** Path in the head revision, or the deleted path when the file is gone. */
  path: string
  /** Present only for renames and copies. */
  old_path: string | null
  /** Blob in the base revision; `null` when the file was added. */
  base_blob_sha: string | null
  /** Blob in the head revision; `null` when the file was deleted. */
  head_blob_sha: string | null
}

export type ReviewStatus = 'open' | 'submitted'

/**
 * One review over a revision range.
 *
 * `head` advances as the agent responds, which is what makes review a loop
 * rather than a single pass; `base` stays put so the range always describes the
 * whole change under discussion.
 */
export interface Review {
  id: string
  repo_path: string
  /** The revisions as requested, kept for display; may be names like `main`. */
  base: string
  head: string
  /** The same revisions resolved to commit shas at the time of each update. */
  base_sha: string
  head_sha: string
  status: ReviewStatus
  files: ReviewFile[]
  threads: Thread[]
  /** Head shas this review has been through, oldest first. */
  rounds: string[]
  created_at: string
  updated_at: string
}

export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  /** 1-based line in the base blob, or null for an added line. */
  base_line: number | null
  /** 1-based line in the head blob, or null for a removed line. */
  head_line: number | null
  text: string
}

export interface DiffHunk {
  /** The `@@ ... @@` header, including any trailing section heading git found. */
  header: string
  lines: DiffLine[]
}

export interface FileDiff extends ReviewFile {
  hunks: DiffHunk[]
  is_binary: boolean
}
