import type { SerializedError } from '@reduxjs/toolkit'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'

export type QueryError = FetchBaseQueryError | SerializedError

export interface DescribedError {
  /** The HTTP status, or null when the request never got to the daemon. */
  status: number | null
  /** Tells if the daemon answered that the item really does not exist. */
  is_missing: boolean
  message: string
}

const DAEMON_UNREACHABLE = 'Could not reach the yart daemon. Is it running?'

/** The statuses that a proxy returns when the daemon behind it does not answer. */
const GATEWAY_STATUSES = new Set([502, 503, 504])

const isFetchError = (error: QueryError): error is FetchBaseQueryError => 'status' in error

/**
 * Changes a failed query into a message for a person.
 *
 * Without this, the UI cannot tell "the daemon says that the review does not
 * exist" apart from "the daemon did not answer". The two become a missing
 * `data`, which looks like an empty result. That is the opposite of what
 * occurred.
 */
export const describeQueryError = (error: QueryError | undefined): DescribedError => {
  if (error === undefined) {
    return { status: null, is_missing: false, message: 'Unknown error' }
  }

  if (!isFetchError(error)) {
    return { status: null, is_missing: false, message: error.message ?? 'Unknown error' }
  }

  if (typeof error.status === 'number') {
    const body = error.data as { error?: string } | undefined
    // A gateway error means that the proxy in front of the daemon could not
    // connect to it. That is the same as a failed connection. Thus it gets the
    // same advice, not only a status code.
    if (GATEWAY_STATUSES.has(error.status)) {
      return { status: error.status, is_missing: false, message: DAEMON_UNREACHABLE }
    }
    return {
      status: error.status,
      is_missing: error.status === 404,
      message: body?.error ?? `Request failed with ${error.status}`,
    }
  }

  // FETCH_ERROR means that the request did not complete. On a local computer, this
  // almost always means that the daemon does not run.
  if (error.status === 'FETCH_ERROR') {
    return { status: null, is_missing: false, message: DAEMON_UNREACHABLE }
  }

  if (error.status === 'PARSING_ERROR') {
    return { status: error.originalStatus, is_missing: false, message: 'Malformed response' }
  }

  if (error.status === 'TIMEOUT_ERROR') {
    return { status: null, is_missing: false, message: 'The daemon timed out' }
  }

  return { status: null, is_missing: false, message: 'Unexpected error' }
}
