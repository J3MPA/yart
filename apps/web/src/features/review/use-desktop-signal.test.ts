import { describe, expect, it } from 'vitest'
import { newlyUnseen } from './use-desktop-signal'

describe('newlyUnseen', () => {
  it('announces nothing on the first look, however much is waiting', () => {
    expect(newlyUnseen(null, new Set(['a', 'b']))).toEqual([])
  })

  it('announces a review that has turned unseen since the last look', () => {
    expect(newlyUnseen(new Set(['a']), new Set(['a', 'b']))).toEqual(['b'])
  })

  it('announces nothing when reviews are only being seen', () => {
    expect(newlyUnseen(new Set(['a', 'b']), new Set(['a']))).toEqual([])
  })

  it('announces a review again once it was seen and the agent answered again', () => {
    expect(newlyUnseen(new Set([]), new Set(['a']))).toEqual(['a'])
  })
})
