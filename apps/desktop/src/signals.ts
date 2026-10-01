import { REVIEW_ID } from './links.ts'

/** A review the agent has just answered on, as the page reports it. */
export interface Notice {
  review_id: string
  title: string
}

/**
 * The page's messages are checked rather than trusted, since they decide what
 * the dock shows and which review a notification opens.
 */
export const parseCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null

export const parseNotice = (value: unknown): Notice | null => {
  if (typeof value !== 'object' || value === null) return null
  const { review_id, title } = value as Record<string, unknown>
  if (typeof review_id !== 'string' || !REVIEW_ID.test(review_id)) return null
  if (typeof title !== 'string' || title.trim() === '') return null
  return { review_id, title }
}
