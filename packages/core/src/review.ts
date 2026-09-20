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
 * What a reviewer said when they handed the review back.
 *
 * Mirrors the three things a pull request review can be, because the agent has
 * to act differently on each: approved means stop, changes requested means fix,
 * commented means read them and use judgement.
 */
export type ReviewVerdict = 'commented' | 'approved' | 'changes_requested'

export interface ReviewSubmission {
  id: string
  verdict: ReviewVerdict
  /** Summary written when submitting, separate from any line comments. */
  body: string | null
  /** The head this verdict was passed on; a later head reopens the review. */
  head_sha: string
  created_at: string
}

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
  /**
   * What this review is called.
   *
   * Defaults to the head commit's subject, because a revision range is not a
   * name: `main..HEAD` says nothing once HEAD has moved, and a full hash says
   * nothing at all.
   */
  title: string
  /** Branch at the head revision, when the head is a branch tip. */
  head_branch: string | null
  /** The revisions as requested, kept for display; may be names like `main`. */
  base: string
  head: string
  /** The same revisions resolved to commit shas at the time of each update. */
  base_sha: string
  head_sha: string
  status: ReviewStatus
  /** Every hand-back, oldest first. The last one is the current verdict. */
  submissions: ReviewSubmission[]
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
