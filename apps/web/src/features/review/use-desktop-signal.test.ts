import { describe, expect, it } from 'vitest'
import { newlyWaiting } from './use-desktop-signal'

describe('newlyWaiting', () => {
  it('announces nothing on the first look, however much is waiting', () => {
    expect(newlyWaiting(null, new Set(['a', 'b']))).toEqual([])
  })

  it('announces a review that started to wait since the last look', () => {
    expect(newlyWaiting(new Set(['a']), new Set(['a', 'b']))).toEqual(['b'])
  })

  it('announces nothing when reviews stop to wait', () => {
    expect(newlyWaiting(new Set(['a', 'b']), new Set(['a']))).toEqual([])
  })

  it('announces a review again when it waits again', () => {
    expect(newlyWaiting(new Set([]), new Set(['a']))).toEqual(['a'])
  })
})
