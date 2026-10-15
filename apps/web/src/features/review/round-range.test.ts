import type { Review, ReviewSubmission } from '@yart/core'
import { describe, expect, it } from 'vitest'
import { defaultRange, headSideOnly, roundOf, sinceHead } from './round-range'
import { anchorKey } from './thread-anchors'

const verdict = (head_sha: string, author: 'human' | 'reviewer' = 'human'): ReviewSubmission =>
  ({ id: `s-${head_sha}`, verdict: 'changes_requested', author, head_sha }) as ReviewSubmission

const review = (rounds: string[], submissions: ReviewSubmission[] = []): Review =>
  ({ rounds, head_sha: rounds[rounds.length - 1], submissions }) as Review

describe('sinceHead', () => {
  it('is null for a review with one round', () => {
    expect(sinceHead(review(['h1']))).toBeNull()
  })

  it('is the round before this one when the person gave no verdict', () => {
    expect(sinceHead(review(['h1', 'h2', 'h3']))).toBe('h2')
  })

  it('is the head of the last verdict of the person, over more than one round', () => {
    expect(sinceHead(review(['h1', 'h2', 'h3'], [verdict('h1'), verdict('h2', 'reviewer')]))).toBe(
      'h1',
    )
  })

  it('is the round before this one when the verdict is on the current head', () => {
    expect(sinceHead(review(['h1', 'h2'], [verdict('h2')]))).toBe('h1')
  })
})

describe('defaultRange', () => {
  it('opens on the new work when the agent moved the review after the verdict', () => {
    expect(defaultRange(review(['h1', 'h2'], [verdict('h1')]))).toBe('since')
  })

  it('opens on all changes before the person gave a verdict', () => {
    expect(defaultRange(review(['h1', 'h2'], [verdict('h1', 'reviewer')]))).toBe('all')
    expect(defaultRange(review(['h1']))).toBe('all')
  })

  it('opens on all changes when the verdict is on the current head', () => {
    expect(defaultRange(review(['h1', 'h2'], [verdict('h2')]))).toBe('all')
  })
})

describe('roundOf', () => {
  it('numbers the rounds from 1', () => {
    expect(roundOf(review(['h1', 'h2']), 'h2')).toBe(2)
  })
})

describe('headSideOnly', () => {
  it('drops the anchors on the base side', () => {
    const by_anchor = new Map([
      [anchorKey('a.ts', 'base', 3), 'base'],
      [anchorKey('a.ts', 'head', 3), 'head'],
    ])
    expect([...headSideOnly(by_anchor).values()]).toEqual(['head'])
  })
})
