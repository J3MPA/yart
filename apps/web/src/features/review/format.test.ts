import { describe, expect, it } from 'vitest'
import type { Comment, CommentAuthor, Review, ReviewSubmission, Thread } from '@yart/core'
import { describeStatus, relativeTime, repositoryName, shortSha } from './format'

const NOW = Date.parse('2026-09-20T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('shortSha', () => {
  it('keeps enough to be recognisable', () => {
    expect(shortSha('91107204638b017e8c3dd4dec2d7c08e6e7afbf9')).toBe('91107204')
  })

  it('leaves a short string alone', () => {
    expect(shortSha('abc')).toBe('abc')
  })
})

describe('relativeTime', () => {
  it('reports the last minute as just now', () => {
    expect(relativeTime(ago(30_000), NOW)).toBe('just now')
  })

  it('singularises one minute', () => {
    expect(relativeTime(ago(90_000), NOW)).toBe('1 minute ago')
  })

  it('reports minutes', () => {
    expect(relativeTime(ago(25 * 60_000), NOW)).toBe('25 minutes ago')
  })

  it('reports hours', () => {
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe('3 hours ago')
  })

  it('reports days', () => {
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe('2 days ago')
  })

  it('does not crash on an unparseable timestamp', () => {
    expect(relativeTime('not a date', NOW)).toBe('unknown')
  })
})

const comment = (author: CommentAuthor): Comment => ({
  id: `${author}-${Math.random()}`,
  author,
  body: 'text',
  created_at: '2026-09-25T12:00:00.000Z',
})

const thread = (authors: readonly CommentAuthor[]): Thread =>
  ({ id: 't', status: 'open', comments: authors.map(comment) }) as Thread

const verdict = (value: ReviewSubmission['verdict'], head_sha = 'head1'): ReviewSubmission => ({
  id: 's',
  verdict: value,
  body: null,
  comments: [],
  head_sha,
  created_at: '2026-09-25T12:00:00.000Z',
})

const review = (partial: Partial<Review>): Review =>
  ({ head_sha: 'head1', submissions: [], threads: [], ...partial }) as Review

describe('describeStatus', () => {
  it('is open before anything has been submitted', () => {
    expect(describeStatus(review({ threads: [thread(['human'])] }))).toMatchObject({
      label: 'open',
      tone: 'plain',
    })
  })

  it('shows the verdict while the agent has not started', () => {
    const status = describeStatus(
      review({ submissions: [verdict('changes_requested')], threads: [thread(['human'])] }),
    )
    expect(status).toMatchObject({ label: 'changes requested', tone: 'changes' })
  })

  it('shows an approval as one', () => {
    expect(describeStatus(review({ submissions: [verdict('approved')] }))).toMatchObject({
      label: 'approved',
      tone: 'approved',
    })
  })

  it('gives way to the agent working once it has started', () => {
    const status = describeStatus(
      review({
        submissions: [verdict('changes_requested')],
        threads: [thread(['human', 'agent']), thread(['human'])],
      }),
    )
    expect(status).toEqual({
      label: 'agent working',
      tone: 'working',
      detail: '1 of 2 comments answered',
    })
  })

  it('says whose turn it is once nothing is waiting on the agent', () => {
    const status = describeStatus(
      review({
        submissions: [verdict('changes_requested')],
        threads: [thread(['human', 'agent'])],
      }),
    )
    expect(status).toEqual({
      label: 'your turn',
      tone: 'ready',
      detail: '1 of 1 comments answered',
    })
  })

  it('reads the latest verdict once the agent has moved the head past it', () => {
    // The current head has no verdict yet, which is exactly the moment the
    // status should say the agent has done something.
    const status = describeStatus(
      review({ head_sha: 'head2', submissions: [verdict('changes_requested', 'head1')] }),
    )
    expect(status).toMatchObject({ label: 'your turn', detail: null })
  })
})

describe('repositoryName', () => {
  it('takes the last part of the path', () => {
    expect(repositoryName('/Users/someone/projects/yart')).toBe('yart')
  })

  it('ignores a trailing slash', () => {
    expect(repositoryName('/Users/someone/projects/yart/')).toBe('yart')
  })
})
