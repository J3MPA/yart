/** What happens to a review once it is approved. */
export type ApprovalAction = 'keep' | 'archive' | 'delete'

/** How hard an AI reviewer should think, for whatever starts one to pass on. */
export type ReviewerEffort = 'low' | 'medium' | 'high'

/** The daemon's settings, one set for every repository it serves. */
export interface Settings {
  on_approve: ApprovalAction
  /**
   * How many verdicts an AI reviewer may pass on one review. Past that, two
   * agents that will not agree stop, and the review is the person's.
   */
  ai_review_rounds: number
  /**
   * The model an AI reviewer should run on, such as `sonnet` or a full model
   * id, or null to leave it to whatever starts the reviewer. yart runs no model
   * itself: this is read by the agent or hook that does.
   */
  reviewer_model: string | null
  reviewer_effort: ReviewerEffort | null
  /** What the person wants a reviewer to look for, added to its instructions. */
  reviewer_instructions: string | null
}

export const MIN_AI_REVIEW_ROUNDS = 1
export const MAX_AI_REVIEW_ROUNDS = 10
export const MAX_REVIEWER_MODEL_LENGTH = 100
export const MAX_REVIEWER_INSTRUCTIONS_LENGTH = 4000
export const REVIEWER_EFFORTS: readonly ReviewerEffort[] = ['low', 'medium', 'high']

export const DEFAULT_SETTINGS: Settings = {
  on_approve: 'keep',
  ai_review_rounds: 3,
  reviewer_model: null,
  reviewer_effort: null,
  reviewer_instructions: null,
}

export const isAiReviewRounds = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_AI_REVIEW_ROUNDS &&
  value <= MAX_AI_REVIEW_ROUNDS

export const isReviewerEffort = (value: unknown): value is ReviewerEffort =>
  typeof value === 'string' && (REVIEWER_EFFORTS as readonly string[]).includes(value)
