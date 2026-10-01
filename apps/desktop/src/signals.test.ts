import { describe, expect, it } from 'vitest'
import { parseCount, parseNotice } from './signals.ts'

describe('parseCount', () => {
  it('accepts a whole number of reviews, including none', () => {
    expect(parseCount(0)).toBe(0)
    expect(parseCount(3)).toBe(3)
  })

  it('refuses anything that is not one', () => {
    expect(parseCount(-1)).toBeNull()
    expect(parseCount(1.5)).toBeNull()
    expect(parseCount('3')).toBeNull()
    expect(parseCount(null)).toBeNull()
  })
})

describe('parseNotice', () => {
  it('accepts a review id and its title', () => {
    expect(parseNotice({ review_id: 'abc-123', title: 'fix: a thing' })).toEqual({
      review_id: 'abc-123',
      title: 'fix: a thing',
    })
  })

  it('refuses an id that could step outside the review page', () => {
    expect(parseNotice({ review_id: '../etc', title: 'x' })).toBeNull()
  })

  it('refuses a notice with no title to show', () => {
    expect(parseNotice({ review_id: 'abc', title: '  ' })).toBeNull()
    expect(parseNotice({ review_id: 'abc' })).toBeNull()
    expect(parseNotice('abc')).toBeNull()
  })
})
