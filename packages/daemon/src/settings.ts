import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  isAiReviewRounds,
  isReviewerEffort,
  MAX_AI_REVIEW_ROUNDS,
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
 * Optional free text: trimmed, with empty meaning unset, or undefined when the
 * value is not text of an acceptable length at all.
 */
const optionalText = (value: unknown, max_length: number): string | null | undefined => {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.length > max_length ? undefined : trimmed
}

/**
 * Reads settings from what was stored, leaving anything missing or invalid at
 * its default rather than refusing to start over one bad value.
 */
const fromStored = (stored: Record<string, unknown>): Settings => {
  const model = optionalText(stored.reviewer_model, MAX_REVIEWER_MODEL_LENGTH)
  const instructions = optionalText(stored.reviewer_instructions, MAX_REVIEWER_INSTRUCTIONS_LENGTH)
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
  }
}

/**
 * Where the daemon's settings are kept.
 *
 * Kept by the daemon rather than in a browser, so that they apply the same in
 * the app, in any browser, and when no window is open at all.
 */
export class SettingsStore {
  private readonly path: string | null
  /** The settings while there is no file, which is what a test wants. */
  private in_memory: Settings = DEFAULT_SETTINGS

  constructor(state_dir: string | null) {
    this.path = state_dir === null ? null : join(state_dir, 'settings.json')
  }

  /** The settings, with anything missing or unreadable left at its default. */
  async read(): Promise<Settings> {
    if (this.path === null) return this.in_memory
    try {
      return fromStored(JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>)
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  /** Changes the settings named, refusing any value that is not one. */
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

    if (this.path === null) {
      this.in_memory = next
      return next
    }
    // Through a temporary file, so that a crash mid-write cannot leave the
    // settings half there.
    await mkdir(join(this.path, '..'), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
    return next
  }
}
