import type { Review } from '@yart/core'
import { describe, expect, it } from 'vitest'
import { descriptionBlocks } from './description-blocks'

const review = (round_descriptions: (string | null)[]): Review =>
  ({
    rounds: round_descriptions.map((_description, index) => `head${index}`),
    round_descriptions,
  }) as Review

describe('descriptionBlocks', () => {
  it('shows nothing when the agent gave no description', () => {
    expect(descriptionBlocks(review([null]))).toEqual([])
    expect(descriptionBlocks(review([null, null]))).toEqual([])
  })

  it('shows the description of the review open in the first round', () => {
    expect(descriptionBlocks(review(['Adds a cache.']))).toEqual([
      { label: 'Description of the review', body: 'Adds a cache.', collapsed: false },
    ])
  })

  it('shows what changed in this round first, and closes the description of the review', () => {
    expect(descriptionBlocks(review(['Adds a cache.', 'Fixes the key.', 'Adds a test.']))).toEqual([
      { label: 'What changed in this round', body: 'Adds a test.', collapsed: false },
      { label: 'Description of the review', body: 'Adds a cache.', collapsed: true },
    ])
  })

  it('keeps the description of the review open when this round has no description', () => {
    expect(descriptionBlocks(review(['Adds a cache.', null]))).toEqual([
      { label: 'Description of the review', body: 'Adds a cache.', collapsed: false },
    ])
  })

  it('shows what changed in this round without a description of the review', () => {
    expect(descriptionBlocks(review([null, 'Fixes the key.']))).toEqual([
      { label: 'What changed in this round', body: 'Fixes the key.', collapsed: false },
    ])
  })
})
