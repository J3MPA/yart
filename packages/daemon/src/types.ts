import type { Thread } from '@yart/core'
import type { ChangeStatus } from './git.ts'

export type ReviewStatus = 'open' | 'submitted'

export interface ReviewFile {
  status: ChangeStatus
  path: string
  old_path: string | null
  base_blob_sha: string | null
  head_blob_sha: string | null
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
