export type {
  AnchorContext,
  AnchorState,
  Comment,
  CommentAuthor,
  DiffSide,
  FileResolution,
  LineAnchor,
  LineMap,
  Thread,
  ThreadStatus,
} from './types.ts';

export { splitLines } from './lines.ts';
export { buildLineMap, type LineMapOptions } from './line-map.ts';
export { captureContext, DEFAULT_CONTEXT_RADIUS } from './context.ts';
export { createThread, type CreateThreadParams } from './thread.ts';
export { deriveAnchorState, reanchorThread, reanchorThreads } from './reanchor.ts';
