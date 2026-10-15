import type { Attachment } from '@yart/core'
import { readStored, writeStored } from './browser-storage'

/**
 * The text of each comment form that the person did not send yet.
 *
 * A form unmounts when the person presses Escape, opens a different row, or
 * when the page shows an error. The text must not go away with it. Thus each
 * form keeps its text here, under the line, thread or verdict that it is for.
 * The form takes the text back when it opens again. The text goes away only
 * when the daemon saved the comment.
 */
const KEY = 'yart.unsent.v1'

/** The most texts to keep. The oldest goes first. A form that nobody opens again must not stay forever. */
export const MAX_UNSENT = 100

export interface Unsent {
  body: string
  attachments: Attachment[]
}

export type UnsentStore = Readonly<Record<string, Unsent>>

/** The key of a form: the review, then the line, thread or verdict of the form. */
export const unsentKey = (review_id: string, target: string): string => `${review_id} ${target}`

const isEmpty = (unsent: Unsent): boolean =>
  unsent.body.trim() === '' && unsent.attachments.length === 0

/**
 * The store with a new text for a key. An empty text removes the key. The key
 * of the newest text goes to the end, thus the oldest texts go first.
 */
export const withUnsent = (store: UnsentStore, key: string, unsent: Unsent | null): UnsentStore => {
  const next: Record<string, Unsent> = { ...store }
  delete next[key]
  if (unsent === null || isEmpty(unsent)) return next
  next[key] = unsent
  const keys = Object.keys(next)
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_UNSENT))) delete next[old]
  return next
}

export const readUnsent = (key: string): Unsent | null =>
  readStored<UnsentStore>(KEY, {})[key] ?? null

export const writeUnsent = (key: string, unsent: Unsent | null): void => {
  const store = readStored<UnsentStore>(KEY, {})
  if ((unsent === null || isEmpty(unsent)) && store[key] === undefined) return
  writeStored(KEY, withUnsent(store, key, unsent))
}
