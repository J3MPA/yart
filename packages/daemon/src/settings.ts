import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  isAiReviewRounds,
  isReviewerEffort,
  MAX_AI_REVIEW_ROUNDS,
  MAX_REVIEWER_COMMAND_LENGTH,
  MAX_REVIEWER_INSTRUCTIONS_LENGTH,
  MAX_REVIEWER_MODEL_LENGTH,
  MIN_AI_REVIEW_ROUNDS,
  REVIEWER_EFFORTS,
  type ApprovalAction,
  type Settings,
} from '@yart/core'
import { ReviewError } from './review.ts'

const APPROVAL_ACTIONS: ReadonlySet<string> = new Set<ApprovalAction>(['keep', 'archive', 'delete'])

const isApprovalAction = (value: unknown): value is ApprovalAction =>
  typeof value === 'string' && APPROVAL_ACTIONS.has(value)

/**
 * Optional free text, without spaces at the start and the end. Empty text means
 * that the setting is not set. Returns undefined when the value is not text, or
 * is too long.
 */
const optionalText = (value: unknown, max_length: number): string | null | undefined => {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.length > max_length ? undefined : trimmed
}

/**
 * Reads the settings from the stored values. A missing or incorrect value gets
 * its default. One bad value does not stop the daemon.
 */
const fromStored = (stored: Record<string, unknown>): Settings => {
  const model = optionalText(stored.reviewer_model, MAX_REVIEWER_MODEL_LENGTH)
  const instructions = optionalText(stored.reviewer_instructions, MAX_REVIEWER_INSTRUCTIONS_LENGTH)
  const command = optionalText(stored.reviewer_command, MAX_REVIEWER_COMMAND_LENGTH)
  return {
    on_approve: isApprovalAction(stored.on_approve)
      ? stored.on_approve
      : DEFAULT_SETTINGS.on_approve,
    ai_review_rounds: isAiReviewRounds(stored.ai_review_rounds)
      ? stored.ai_review_rounds
      : DEFAULT_SETTINGS.ai_review_rounds,
    reviewer_model: model === undefined ? DEFAULT_SETTINGS.reviewer_model : model,
    reviewer_effort: isReviewerEffort(stored.reviewer_effort)
      ? stored.reviewer_effort
      : DEFAULT_SETTINGS.reviewer_effort,
    reviewer_instructions:
      instructions === undefined ? DEFAULT_SETTINGS.reviewer_instructions : instructions,
    reviewer_command: command === undefined ? DEFAULT_SETTINGS.reviewer_command : command,
  }
}

export const settingsPath = (state_dir: string): string => join(state_dir, 'settings.json')

/**
 * Where the settings of the daemon are kept.
 *
 * The daemon keeps them, not a browser. Thus they apply in the same way in the
 * app, in each browser, and when no window is open.
 */
export class SettingsStore {
  private readonly path: string | null
  /** The settings when there is no file. Tests use this. */
  private in_memory: Settings = DEFAULT_SETTINGS

  constructor(state_dir: string | null) {
    this.path = state_dir === null ? null : settingsPath(state_dir)
  }

  /** The settings. A missing value, or a value that cannot be read, gets its default. */
  async read(): Promise<Settings> {
    if (this.path === null) return this.in_memory
    try {
      return fromStored(JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>)
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  /** Changes the named settings. Refuses each value that is not correct. */
  async update(changes: Record<string, unknown>): Promise<Settings> {
    const next = { ...(await this.read()) }
    if (changes.on_approve !== undefined) {
      if (!isApprovalAction(changes.on_approve)) {
        throw new ReviewError('on_approve must be "keep", "archive" or "delete"', 400)
      }
      next.on_approve = changes.on_approve
    }
    if (changes.ai_review_rounds !== undefined) {
      if (!isAiReviewRounds(changes.ai_review_rounds)) {
        throw new ReviewError(
          `ai_review_rounds must be a whole number from ${MIN_AI_REVIEW_ROUNDS} to ${MAX_AI_REVIEW_ROUNDS}`,
          400,
        )
      }
      next.ai_review_rounds = changes.ai_review_rounds
    }
    if (changes.reviewer_model !== undefined) {
      const model = optionalText(changes.reviewer_model, MAX_REVIEWER_MODEL_LENGTH)
      if (model === undefined) {
        throw new ReviewError(
          `reviewer_model must be a model name of at most ${MAX_REVIEWER_MODEL_LENGTH} characters, or null`,
          400,
        )
      }
      next.reviewer_model = model
    }
    if (changes.reviewer_effort !== undefined) {
      if (changes.reviewer_effort !== null && !isReviewerEffort(changes.reviewer_effort)) {
        throw new ReviewError(
          `reviewer_effort must be one of ${REVIEWER_EFFORTS.join(', ')}, or null`,
          400,
        )
      }
      next.reviewer_effort = changes.reviewer_effort
    }
    if (changes.reviewer_instructions !== undefined) {
      const instructions = optionalText(
        changes.reviewer_instructions,
        MAX_REVIEWER_INSTRUCTIONS_LENGTH,
      )
      if (instructions === undefined) {
        throw new ReviewError(
          `reviewer_instructions must be text of at most ${MAX_REVIEWER_INSTRUCTIONS_LENGTH} characters, or null`,
          400,
        )
      }
      next.reviewer_instructions = instructions
    }
    if (changes.reviewer_command !== undefined) {
      const command = optionalText(changes.reviewer_command, MAX_REVIEWER_COMMAND_LENGTH)
      if (command === undefined) {
        throw new ReviewError(
          `reviewer_command must be a command of at most ${MAX_REVIEWER_COMMAND_LENGTH} characters, or null`,
          400,
        )
      }
      next.reviewer_command = command
    }

    if (this.path === null) {
      this.in_memory = next
      return next
    }
    // Write through a temporary file. Thus a crash during the write cannot leave
    // half of the settings.
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.tmp`
    // Only the user can write it. The commit hook runs the reviewer command from
    // this file, and refuses a file that other users can write.
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.path)
    return next
  }
}
