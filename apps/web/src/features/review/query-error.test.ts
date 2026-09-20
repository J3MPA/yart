import { describe, expect, it } from 'vitest'
import { describeQueryError, type QueryError } from './query-error'

describe('describeQueryError', () => {
  it('reports a 404 as genuinely missing', () => {
    const described = describeQueryError({ status: 404, data: { error: 'No review with id x' } })
    expect(described).toMatchObject({ status: 404, is_missing: true })
    expect(described.message).toBe('No review with id x')
  })

  it('does not treat other statuses as missing', () => {
    expect(describeQueryError({ status: 500, data: {} }).is_missing).toBe(false)
  })

  it("uses the daemon's own message when it sends one", () => {
    const described = describeQueryError({
      status: 400,
      data: { error: 'Cannot resolve revision "nope"' },
    })
    expect(described.message).toBe('Cannot resolve revision "nope"')
  })

  it('falls back to the status when there is no message', () => {
    expect(describeQueryError({ status: 500, data: undefined }).message).toBe(
      'Request failed with 500',
    )
  })

  it('treats a gateway error as the daemon being unreachable', () => {
    // Vite proxies /api to the daemon in development, so a dead daemon surfaces
    // as a 502 rather than a failed connection.
    for (const status of [502, 503, 504]) {
      const described = describeQueryError({ status, data: undefined })
      expect(described.message).toMatch(/daemon/i)
      expect(described.is_missing).toBe(false)
    }
  })

  it('says the daemon is unreachable when the request never completed', () => {
    const described = describeQueryError({ status: 'FETCH_ERROR', error: 'failed to fetch' })
    expect(described.status).toBeNull()
    expect(described.is_missing).toBe(false)
    expect(described.message).toMatch(/daemon/i)
  })

  it('reports a timeout distinctly', () => {
    const described = describeQueryError({ status: 'TIMEOUT_ERROR', error: 'timed out' })
    expect(described.message).toMatch(/timed out/i)
  })

  it('reports a malformed response with the status it came with', () => {
    const described = describeQueryError({
      status: 'PARSING_ERROR',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- RTK Query's field name
      originalStatus: 502,
      data: '<html>',
      error: 'bad json',
    })
    expect(described).toMatchObject({ status: 502, message: 'Malformed response' })
  })

  it('handles a serialized (non-fetch) error', () => {
    expect(describeQueryError({ message: 'boom', name: 'Error' }).message).toBe('boom')
  })

  it('handles no error at all rather than throwing', () => {
    expect(describeQueryError(undefined)).toMatchObject({ status: null, is_missing: false })
  })

  it('never reports a failure as missing by default, since that reads as empty', () => {
    const failures: QueryError[] = [
      { status: 'FETCH_ERROR', error: 'x' },
      { status: 500, data: {} },
      { status: 'TIMEOUT_ERROR', error: 'x' },
      { message: 'boom', name: 'Error' },
    ]
    for (const failure of failures) {
      expect(describeQueryError(failure).is_missing).toBe(false)
    }
  })
})
