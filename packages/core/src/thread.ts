import { captureContext, DEFAULT_CONTEXT_RADIUS } from './context.ts'
import type { Comment, LineAnchor, Thread } from './types.ts'

export interface CreateThreadParams {
  id: string
  /** Where the comment was made. Becomes both `origin` and the initial `anchor`. */
  anchor: LineAnchor
  /** Full text of `anchor.blob_sha`, used to capture surrounding context. */
  content: string
  comment: Comment
  context_radius?: number
}

/**
 * Creates a thread with `origin` and `anchor` in sync and its context captured.
 *
 * Ids and timestamps are supplied by the caller rather than generated here, so
 * that the model stays pure and tests stay deterministic.
 */
export const createThread = ({
  id,
  anchor,
  content,
  comment,
  context_radius = DEFAULT_CONTEXT_RADIUS,
}: CreateThreadParams): Thread => {
  return {
    id,
    origin: anchor,
    context: captureContext(content, anchor.line, context_radius),
    anchor,
    anchor_state: 'current',
    status: 'open',
    comments: [comment],
  }
}
