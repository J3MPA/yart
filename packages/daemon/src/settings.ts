import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type ApprovalAction, type Settings } from '@yart/core'
import { ReviewError } from './review.ts'

const APPROVAL_ACTIONS: ReadonlySet<string> = new Set<ApprovalAction>(['keep', 'archive', 'delete'])

const isApprovalAction = (value: unknown): value is ApprovalAction =>
  typeof value === 'string' && APPROVAL_ACTIONS.has(value)

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
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<Settings>
      return {
        on_approve: isApprovalAction(parsed.on_approve)
          ? parsed.on_approve
          : DEFAULT_SETTINGS.on_approve,
      }
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
