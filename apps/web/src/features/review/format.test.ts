import { describe, expect, it } from 'vitest'
import type { Comment, CommentAuthor, Review, ReviewSubmission, Thread } from '@yart/core'
import { aiPhase } from './ai-review'
import {
  describeAiVerdict,
  describeStatus,
  earlierRound,
  isPersonsTurn,
  personVerdictLabel,
  relativeTime,
  repositoryName,
  shortSha,
} from './format'

const NOW = Date.parse('2026-09-20T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('shortSha', () => {
  it('keeps enough to be recognizable', () => {
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
    expect(describeStatus(review({ threads: [thread(['human'])] }), 3)).toMatchObject({
      label: 'open',
      tone: 'plain',
    })
  })

  it('shows the verdict while the agent has not started', () => {
    const status = describeStatus(
      review({ submissions: [verdict('changes_requested')], threads: [thread(['human'])] }),
      3,
    )
    expect(status).toMatchObject({ label: 'changes requested', tone: 'changes' })
  })

  it('shows an approval as one', () => {
    expect(describeStatus(review({ submissions: [verdict('approved')] }), 3)).toMatchObject({
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
      3,
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
      3,
    )
    expect(status).toEqual({
      label: 'your turn',
      tone: 'ready',
      detail: '1 of 1 comments answered',
    })
  })

  it('reads the latest verdict once the agent has moved the head past it', () => {
    // The current head has no verdict yet. At that time, the status must say
    // that the agent did something.
    const status = describeStatus(
      review({ head_sha: 'head2', submissions: [verdict('changes_requested', 'head1')] }),
      3,
    )
    expect(status).toMatchObject({ label: 'your turn', detail: null })
  })
})

const byReviewer = (
  value: ReviewSubmission['verdict'],
  head_sha = 'head1',
  created_at = '2026-09-25T12:00:00.000Z',
): ReviewSubmission => ({ ...verdict(value, head_sha), author: 'reviewer', created_at })

describe('describeStatus in the AI phase', () => {
  it('shows the AI round while the agent answers the AI reviewer', () => {
    const status = describeStatus(
      review({ submissions: [byReviewer('changes_requested')], threads: [thread(['reviewer'])] }),
      3,
    )
    expect(status).toEqual({
      label: 'AI review · round 1 of 3',
      tone: 'ai',
      detail: 'The agent answers the AI reviewer. 0 of 1 comments answered.',
    })
  })

  it('shows the next AI round after the agent moved the review', () => {
    const status = describeStatus(
      review({ head_sha: 'head2', submissions: [byReviewer('changes_requested', 'head1')] }),
      3,
    )
    expect(status).toMatchObject({ label: 'AI review · round 2 of 3', tone: 'ai' })
  })

  it('gives the turn to the person when the AI reviewer approved', () => {
    const status = describeStatus(review({ submissions: [byReviewer('approved')] }), 3)
    expect(status).toEqual({
      label: 'your turn',
      tone: 'ready',
      detail: 'The AI reviewer approved.',
    })
  })

  it('gives the turn to the person when the AI reviewer has no rounds left', () => {
    const status = describeStatus(
      review({
        head_sha: 'head3',
        submissions: [
          byReviewer('changes_requested', 'head1'),
          byReviewer('changes_requested', 'head2'),
        ],
      }),
      2,
    )
    expect(status).toEqual({
      label: 'your turn',
      tone: 'ready',
      detail: 'The AI reviewer used all 2 rounds.',
    })
  })

  it('ends the AI phase when the person gives a verdict', () => {
    const status = describeStatus(
      review({ submissions: [byReviewer('approved'), verdict('changes_requested')] }),
      3,
    )
    expect(status).toMatchObject({ label: 'changes requested', tone: 'changes' })
  })
})

describe('isPersonsTurn', () => {
  it('is false for a review with no verdict', () => {
    expect(isPersonsTurn(review({}), 3)).toBe(false)
  })

  it('is false while the AI reviewer has rounds left', () => {
    expect(isPersonsTurn(review({ submissions: [byReviewer('changes_requested')] }), 3)).toBe(false)
  })

  it('is true after an AI approval', () => {
    expect(isPersonsTurn(review({ submissions: [byReviewer('approved')] }), 3)).toBe(true)
  })

  it('is true when the agent answered a verdict of the person', () => {
    const answered = review({ head_sha: 'head2', submissions: [verdict('commented', 'head1')] })
    expect(isPersonsTurn(answered, 3)).toBe(true)
  })
})

describe('describeAiVerdict', () => {
  const phaseOf = (submissions: ReviewSubmission[], limit = 3, head_sha = 'head1') => {
    const phase = aiPhase(review({ submissions, head_sha }), limit)
    if (phase === null) throw new Error('expected an AI phase')
    return phase
  }

  it('tells the person that their review is next after an approval', () => {
    expect(describeAiVerdict(phaseOf([byReviewer('approved')]))).toBe(
      'AI reviewer approved. Your review is next.',
    )
  })

  it('names the reviewer when it has a name', () => {
    const named = { ...byReviewer('approved'), author_name: 'opus' }
    expect(describeAiVerdict(phaseOf([named]))).toBe(
      'AI reviewer opus approved. Your review is next.',
    )
  })

  it('tells that the AI loop goes on while rounds are left', () => {
    expect(describeAiVerdict(phaseOf([byReviewer('changes_requested')]))).toBe(
      'AI reviewer requested changes in round 1 of 3. ' +
        'The agent answers, and then the AI reviewer looks again.',
    )
  })

  it('tells that the AI reviewer looks again after the agent moved the review', () => {
    expect(describeAiVerdict(phaseOf([byReviewer('changes_requested')], 3, 'head2'))).toBe(
      'AI reviewer requested changes in round 1 of 3. ' +
        'The agent answered, and the AI reviewer looks again.',
    )
  })

  it('tells the person that their review is next after the last round', () => {
    expect(describeAiVerdict(phaseOf([byReviewer('commented')], 1))).toBe(
      'AI reviewer commented in its last round (1 of 1). Your review is next.',
    )
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

describe('personVerdictLabel', () => {
  const rounds = review({ rounds: ['head1', 'head2'], head_sha: 'head2' })

  it('shows the verdict alone on the current head', () => {
    const on_head = verdict('approved', 'head2')
    expect(earlierRound(rounds, on_head)).toBeNull()
    expect(personVerdictLabel(rounds, on_head)).toBe('approved')
  })

  it('names the round of a verdict on an earlier round', () => {
    const before = verdict('approved', 'head1')
    expect(earlierRound(rounds, before)).toBe(1)
    expect(personVerdictLabel(rounds, before)).toBe('Your verdict on round 1 · approved')
  })

  it('names no number when the head of the verdict is not a round', () => {
    expect(personVerdictLabel(rounds, verdict('changes_requested', 'gone'))).toBe(
      'Your verdict on an earlier round · changes requested',
    )
  })
})
