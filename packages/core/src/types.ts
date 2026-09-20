/** Which side of a review's diff a line belongs to. */
export type DiffSide = 'base' | 'head'

/**
 * Points at one line of one version of one file.
 *
 * Identity is the blob hash rather than the path, because paths move and line
 * numbers shift, whereas a blob's content is immutable — so `(blob_sha, line)`
 * always denotes the same text no matter what happens to the working tree.
 */
export interface LineAnchor {
  /** Path the file had in the version this anchor was resolved against. */
  path: string
  /** Git blob hash of that file version. */
  blob_sha: string
  /** 1-based line number within `blob_sha`. */
  line: number
  side: DiffSide
}

/**
 * Text surrounding an anchor, captured when the thread is created.
 *
 * Kept verbatim and never updated: once an anchor goes outdated this is the
 * only remaining record of what was being discussed.
 */
export interface AnchorContext {
  before: string[]
  line: string
  after: string[]
}

/**
 * Where a thread sits relative to where it was created.
 *
 * - `current`  — same file, same line as at creation
 * - `shifted`  — the line survives, but has moved or the file was renamed
 * - `outdated` — the line no longer exists; only `context` survives
 */
export type AnchorState = 'current' | 'shifted' | 'outdated'

/** Conversational state, independent of whether the anchor still resolves. */
export type ThreadStatus = 'open' | 'resolved'

export type CommentAuthor = 'human' | 'agent'

export interface Comment {
  id: string
  author: CommentAuthor
  body: string
  /** ISO 8601. */
  created_at: string
}

export interface Thread {
  id: string
  /** Where the thread was created. Immutable — the audit record. */
  origin: LineAnchor
  /** Text captured at creation. Immutable. */
  context: AnchorContext
  /** Where the thread points now, or `null` once the line is gone. */
  anchor: LineAnchor | null
  anchor_state: AnchorState
  status: ThreadStatus
  comments: Comment[]
}

/**
 * Maps 1-based line numbers in one version of a file to the corresponding line
 * in a later version. Lines absent from the map did not survive.
 *
 * How the mapping is computed is deliberately not this model's concern: it can
 * come from a text diff, from parsing `git diff` output, or from a test fixture.
 */
export type LineMap = ReadonlyMap<number, number>

/** What became of an anchored file in a later revision. */
export type FileResolution =
  | { kind: 'unchanged'; path: string }
  | { kind: 'modified'; path: string; blob_sha: string; line_map: LineMap }
  | { kind: 'deleted' }
