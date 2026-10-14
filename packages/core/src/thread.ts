import { captureContext, DEFAULT_CONTEXT_RADIUS } from './context.ts'
import type { Comment, LineAnchor, Thread } from './types.ts'

export interface CreateThreadParams {
  id: string
  /** Where the comment is. It becomes the `origin` and the first `anchor`. */
  anchor: LineAnchor
  /** The full text of `anchor.blob_sha`. yart keeps the context from it. */
  content: string
  comment: Comment
  context_radius?: number
}

/**
 * Makes a thread. Its `origin` and its `anchor` are the same, and it keeps its
 * context.
 *
 * The caller gives the ids and the times. This function does not make them.
 * Thus the model has no side effects, and tests always give the same result.
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
