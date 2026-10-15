import { describe, expect, it } from 'vitest'
import { reviewDescriptions } from './description.ts'
import type { Review } from './review.ts'

const review = (partial: Partial<Review>): Review =>
  ({ rounds: ['head1'], round_descriptions: [null], ...partial }) as Review

describe('reviewDescriptions', () => {
  it('gives only the description of the review in the first round', () => {
    expect(reviewDescriptions(review({ round_descriptions: ['Adds a cache.'] }))).toEqual({
      review: 'Adds a cache.',
      round: null,
    })
  })

  it('gives the description of the current round in a later round', () => {
    const later = review({
      rounds: ['head1', 'head2', 'head3'],
      round_descriptions: ['Adds a cache.', 'Fixes the key.', 'Adds a test.'],
    })
    expect(reviewDescriptions(later)).toEqual({ review: 'Adds a cache.', round: 'Adds a test.' })
  })

  it('gives null for a round without a description', () => {
    const later = review({
      rounds: ['head1', 'head2'],
      round_descriptions: ['Adds a cache.', null],
    })
    expect(reviewDescriptions(later)).toEqual({ review: 'Adds a cache.', round: null })
  })

  it('accepts a review from before descriptions existed', () => {
    const old = { rounds: ['head1', 'head2'] } as Review
    expect(reviewDescriptions(old)).toEqual({ review: null, round: null })
  })
})
