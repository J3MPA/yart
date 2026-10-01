/** What happens to a review once it is approved. */
export type ApprovalAction = 'keep' | 'archive' | 'delete'

/** The daemon's settings, one set for every repository it serves. */
export interface Settings {
  on_approve: ApprovalAction
}

export const DEFAULT_SETTINGS: Settings = { on_approve: 'keep' }
