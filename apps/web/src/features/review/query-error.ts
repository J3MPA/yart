import type { SerializedError } from '@reduxjs/toolkit'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'

export type QueryError = FetchBaseQueryError | SerializedError

export interface DescribedError {
  /** HTTP status, or null when the request never reached the daemon. */
  status: number | null
  /** Whether the daemon answered that the thing genuinely is not there. */
  is_missing: boolean
  message: string
}

const DAEMON_UNREACHABLE = 'Could not reach the yart daemon. Is it running?'

/** Statuses a proxy returns when the daemon behind it is not answering. */
const GATEWAY_STATUSES = new Set([502, 503, 504])

const isFetchError = (error: QueryError): error is FetchBaseQueryError => 'status' in error

/**
 * Turns a query failure into something worth showing a person.
 *
 * Without this the UI cannot tell "the daemon says there is no such review"
 * from "the daemon did not answer", and both collapse into an absent `data`
 * that reads as an empty result — which is the opposite of what happened.
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
    // A gateway error means the proxy in front of the daemon could not reach
    // it, which is the same situation as a failed connection and deserves the
    // same advice rather than a bare status code.
    if (GATEWAY_STATUSES.has(error.status)) {
      return { status: error.status, is_missing: false, message: DAEMON_UNREACHABLE }
    }
    return {
      status: error.status,
      is_missing: error.status === 404,
      message: body?.error ?? `Request failed with ${error.status}`,
    }
  }

  // FETCH_ERROR means the request never completed, which locally almost always
  // means the daemon is not running.
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
