import type { Attachment, Comment, Thread } from './types.ts'

/**
 * The shapes that the daemon sends over the wire.
 *
 * They are in this package, which has no I/O, because the browser also needs
 * them. If they were next to the git and file system code that makes them, an
 * import of a type would put `node:fs` into the bundle.
 */

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'

export interface ReviewFile {
  status: ChangeStatus
  /** The path in the head revision, or the old path when the file was deleted. */
  path: string
  /** Only for renames and copies. */
  old_path: string | null
  /** The blob in the base revision, or `null` when the file was added. */
  base_blob_sha: string | null
  /** The blob in the head revision, or `null` when the file was deleted. */
  head_blob_sha: string | null
}

export type ReviewStatus = 'open' | 'submitted'

/**
 * What a reviewer said when they gave the review back.
 *
 * These are the three types of a pull request review. The agent must act
 * differently on each. "approved" means stop. "changes_requested" means make
 * the fixes. "commented" means read the comments and decide.
 */
export type ReviewVerdict = 'commented' | 'approved' | 'changes_requested'

/** Who can give a verdict: the person, or an AI reviewer in the place of the person. */
export type SubmissionAuthor = 'human' | 'reviewer'

export interface ReviewSubmission {
  id: string
  verdict: ReviewVerdict
  /** Not on verdicts from before reviewers existed. All of those belong to the person. */
  author?: SubmissionAuthor
  /** The name of the AI reviewer, as on its comments. */
  author_name?: string | null
  /** The summary of the verdict, apart from the line comments. */
  body: string | null
  /** The images of the summary. Not there when the summary has none. */
  attachments?: Attachment[]
  /**
   * The replies to the summary, the oldest first.
   *
   * Without these, a verdict could get no answer. Then the conversation would go
   * out of the tool, into the chat window of the agent. A verdict is not
   * attached to a line. Thus this is a list, not a `Thread`.
   */
  comments: Comment[]
  /** The head of this verdict. A later head opens the review again. */
  head_sha: string
  created_at: string
}

/**
 * One review over a revision range.
 *
 * `head` moves forward when the agent responds. This makes review a loop, not
 * one pass. `base` does not move. Thus the range always shows the full change
 * that the review is about.
 */
export interface Review {
  id: string
  repo_path: string
  /**
   * The name of this review.
   *
   * The default is the subject of the head commit. A revision range is not a
   * good name. `main..HEAD` says nothing after HEAD moves, and a full hash says
   * nothing at all.
   */
  title: string
  /** The branch at the head revision, when the head is the tip of a branch. */
  head_branch: string | null
  /**
   * True when the head is a snapshot of uncommitted work, not a commit.
   *
   * To move such a review, yart makes a new snapshot. It does not name a newer
   * revision, because there is no commit to name.
   */
  head_is_snapshot: boolean
  /** The revisions as the request gave them, for display. They can be names such as `main`. */
  base: string
  head: string
  /** The same revisions as commit shas, at the time of each update. */
  base_sha: string
  head_sha: string
  status: ReviewStatus
  /** All verdicts, the oldest first. The last one is the current verdict. */
  submissions: ReviewSubmission[]
  files: ReviewFile[]
  threads: Thread[]
  /** The head shas of all rounds of this review, the oldest first. */
  rounds: string[]
  /**
   * The text that the agent gave for each round, in the order of `rounds`. The
   * first tells what the review is about. Each later one tells what changed in
   * that round. A round without a text has null.
   *
   * This is a list of its own, not a field of each round. Thus `rounds` keeps its
   * form, and an older file stays valid.
   */
  round_descriptions: (string | null)[]
  created_at: string
  updated_at: string
  /**
   * When this review was archived, or null while it is active.
   *
   * This is a time, not a flag. Thus the list can still sort archived reviews.
   */
  archived_at: string | null
}

export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  /** The line in the base blob, from 1, or null for an added line. */
  base_line: number | null
  /** The line in the head blob, from 1, or null for a removed line. */
  head_line: number | null
  text: string
}

export interface DiffHunk {
  /** The `@@ ... @@` header, with the section heading that git found, if there is one. */
  header: string
  lines: DiffLine[]
}

export interface FileDiff extends ReviewFile {
  hunks: DiffHunk[]
  is_binary: boolean
  /**
   * The count of lines in the head blob, or null when the head has no text to
   * read.
   *
   * The hunks show only what changed. Thus they do not tell if the file
   * continues after the last hunk. This count gives the end of the last run of
   * unchanged lines. The base does not need a count. Unchanged lines exist on the
   * two sides, thus the length of one side gives the length of the other.
   */
  head_line_count: number | null
}

/** The two sides of one file in full, to show the text that the diff does not include. */
export interface FileContents extends ReviewFile {
  base_content: string | null
  head_content: string | null
}
