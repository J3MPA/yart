import { relative, isAbsolute } from 'node:path'
import { ReviewError } from './review-error.ts'

/** The form of the ids that the daemon makes with `randomUUID`. */
const REVIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isReviewId = (value: string): boolean => REVIEW_ID.test(value)

/**
 * Refuses a review id that the daemon did not make. The id goes into file
 * paths. Thus an id such as `../../x` must not get to the disk.
 */
export const checkReviewId = (value: string): string => {
  if (!isReviewId(value)) throw new ReviewError(`No review with id ${value}`, 404)
  return value
}

/**
 * Refuses a path that is not in a directory. This is a second check after the
 * id check, because the result goes to a removal.
 */
export const checkInside = (dir: string, path: string): string => {
  const from_dir = relative(dir, path)
  if (from_dir === '' || from_dir.startsWith('..') || isAbsolute(from_dir)) {
    throw new ReviewError(`${path} is not in ${dir}`, 400)
  }
  return path
}
