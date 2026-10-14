/** What happens to a review after its approval. */
export type ApprovalAction = 'keep' | 'archive' | 'delete'

/** How much effort an AI reviewer must use. The process that starts a reviewer gives it on. */
export type ReviewerEffort = 'low' | 'medium' | 'high'

/** The settings of the daemon. One set applies to all repositories that it serves. */
export interface Settings {
  on_approve: ApprovalAction
  /**
   * How many verdicts an AI reviewer can give on one review. After that, two
   * agents that do not agree stop, and the review goes to the person.
   */
  ai_review_rounds: number
  /**
   * The model for an AI reviewer, such as `sonnet` or a full model id. Null lets
   * the process that starts the reviewer choose. yart does not run a model. The
   * agent or the hook that runs the reviewer reads this setting.
   */
  reviewer_model: string | null
  reviewer_effort: ReviewerEffort | null
  /** What the person wants a reviewer to look for. yart adds it to the instructions. */
  reviewer_instructions: string | null
  /**
   * The shell command that the commit hook runs to start a reviewer, or null.
   * When it is null, the hook does nothing. The command gets the review and the
   * reviewer settings in environment variables, not in its text. Thus a value
   * with quotes cannot break the command.
   */
  reviewer_command: string | null
}

export const MIN_AI_REVIEW_ROUNDS = 1
export const MAX_AI_REVIEW_ROUNDS = 10
export const MAX_REVIEWER_MODEL_LENGTH = 100
export const MAX_REVIEWER_INSTRUCTIONS_LENGTH = 4000
export const MAX_REVIEWER_COMMAND_LENGTH = 2000
export const REVIEWER_EFFORTS: readonly ReviewerEffort[] = ['low', 'medium', 'high']

export const DEFAULT_SETTINGS: Settings = {
  on_approve: 'keep',
  ai_review_rounds: 3,
  reviewer_model: null,
  reviewer_effort: null,
  reviewer_instructions: null,
  reviewer_command: null,
}

export const isAiReviewRounds = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_AI_REVIEW_ROUNDS &&
  value <= MAX_AI_REVIEW_ROUNDS

export const isReviewerEffort = (value: unknown): value is ReviewerEffort =>
  typeof value === 'string' && (REVIEWER_EFFORTS as readonly string[]).includes(value)
