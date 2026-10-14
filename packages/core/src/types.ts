/** The side of the diff of a review that a line belongs to. */
export type DiffSide = 'base' | 'head'

/**
 * Points to one line of one version of one file.
 *
 * The blob hash identifies the file, not the path. Paths move and line numbers
 * change, but the content of a blob never changes. Thus `(blob_sha, line)`
 * always identifies the same text, whatever happens to the working tree.
 */
export interface LineAnchor {
  /** The path of the file in the version of this anchor. */
  path: string
  /** The git blob hash of that version of the file. */
  blob_sha: string
  /** The line number in `blob_sha`, from 1. */
  line: number
  side: DiffSide
}

/**
 * The text around an anchor, kept when yart makes the thread.
 *
 * It stays exactly as it was, and never changes. When an anchor becomes
 * outdated, this is the only record of what the conversation was about.
 */
export interface AnchorContext {
  before: string[]
  line: string
  after: string[]
}

/**
 * Where a thread is, compared with where yart made it.
 *
 * - `current`: the same file and the same line as at the start.
 * - `shifted`: the line is still there, but it moved or the file has a new name.
 * - `outdated`: the line does not exist now. Only `context` stays.
 */
export type AnchorState = 'current' | 'shifted' | 'outdated'

/** The state of the conversation. It does not depend on the anchor. */
export type ThreadStatus = 'open' | 'resolved'

/**
 * Who wrote a comment: the person who reviews, the agent whose work is under
 * review, or an AI reviewer in the place of the person.
 */
export type CommentAuthor = 'human' | 'agent' | 'reviewer'

export interface Comment {
  id: string
  author: CommentAuthor
  /**
   * The name of an AI reviewer, such as `claude-reviewer`. Thus you can tell
   * two reviewers apart. It is not there for the person and the agent, or on
   * comments from before reviewers existed.
   */
  author_name?: string | null
  body: string
  /** ISO 8601. */
  created_at: string
}

export interface Thread {
  id: string
  /** Where yart made the thread. It never changes. It is the record. */
  origin: LineAnchor
  /** The text that yart kept when it made the thread. It never changes. */
  context: AnchorContext
  /** Where the thread points now, or `null` when the line is gone. */
  anchor: LineAnchor | null
  anchor_state: AnchorState
  status: ThreadStatus
  comments: Comment[]
}

/**
 * Maps the line numbers in one version of a file to the same lines in a later
 * version. The numbers start at 1. A line that is not in the map did not stay.
 *
 * This model does not calculate the map, on purpose. The map can come from a
 * text diff, from the output of `git diff`, or from a test fixture.
 */
export type LineMap = ReadonlyMap<number, number>

/** What happened to the file of an anchor in a later revision. */
export type FileResolution =
  | { kind: 'unchanged'; path: string }
  | { kind: 'modified'; path: string; blob_sha: string; line_map: LineMap }
  | { kind: 'deleted' }
