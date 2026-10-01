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
} from './types.ts'

export type {
  ChangeStatus,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  FileContents,
  FileDiff,
  Review,
  ReviewFile,
  ReviewStatus,
  ReviewSubmission,
  ReviewVerdict,
} from './review.ts'

export {
  gapLines,
  gapSlice,
  hunkFirstLines,
  hunkNextLines,
  hunkSectionHeading,
  parseHunkHeader,
  planDiffSections,
  type DiffGap,
  type DiffSection,
  type HunkRange,
} from './hunks.ts'
export {
  currentSubmission,
  latestSubmission,
  reviewProgress,
  threadIsAnswered,
  type ProgressState,
  type ReviewProgress,
} from './progress.ts'
export { agentActivity } from './activity.ts'
export { splitLines } from './lines.ts'
export { buildLineMap, type LineMapOptions } from './line-map.ts'
export { captureContext, DEFAULT_CONTEXT_RADIUS } from './context.ts'
export { createThread, type CreateThreadParams } from './thread.ts'
export { deriveAnchorState, reanchorThread, reanchorThreads } from './reanchor.ts'
export { DEFAULT_SETTINGS, type ApprovalAction, type Settings } from './settings.ts'
