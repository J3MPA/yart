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
} from './types';

export { splitLines } from './lines';
export { buildLineMap, type LineMapOptions } from './line-map';
export { captureContext, DEFAULT_CONTEXT_RADIUS } from './context';
export { createThread, type CreateThreadParams } from './thread';
export { deriveAnchorState, reanchorThread, reanchorThreads } from './reanchor';
