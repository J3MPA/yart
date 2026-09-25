import { describe, expect, it } from 'vitest'
import { forgetMissing, isUnseen, markSeen } from './seen-reviews'

describe('isUnseen', () => {
  it('is false for a review that has never been opened', () => {
    expect(isUnseen({}, 'r1', 5)).toBe(false)
  })

  it('is false while the review is as it was left', () => {
    expect(isUnseen({ r1: 5 }, 'r1', 5)).toBe(false)
  })

  it('is true once the agent has done something since', () => {
    expect(isUnseen({ r1: 5 }, 'r1', 6)).toBe(true)
  })

  it('is false if the stored mark somehow runs ahead', () => {
    expect(isUnseen({ r1: 9 }, 'r1', 5)).toBe(false)
  })
})

describe('markSeen', () => {
  it('records the activity a review was last seen at', () => {
    expect(markSeen({}, 'r1', 3)).toEqual({ r1: 3 })
  })

  it('reports no change when the mark already matches', () => {
    expect(markSeen({ r1: 3 }, 'r1', 3)).toBeNull()
  })

  it('leaves other reviews alone', () => {
    expect(markSeen({ r1: 1, r2: 2 }, 'r1', 4)).toEqual({ r1: 4, r2: 2 })
  })
})

describe('forgetMissing', () => {
  it('keeps only reviews that still exist', () => {
    expect(forgetMissing({ r1: 1, gone: 2 }, ['r1'])).toEqual({ r1: 1 })
  })

  it('empties out when nothing is listed', () => {
    expect(forgetMissing({ r1: 1 }, [])).toEqual({})
  })
})
