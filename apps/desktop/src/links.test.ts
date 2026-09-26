import { describe, expect, it } from 'vitest'
import { reviewIdFromLink } from './links.ts'

describe('reviewIdFromLink', () => {
  it('reads the review a link points at', () => {
    expect(reviewIdFromLink('yart://reviews/9e0d8502-fa83-4747')).toBe('9e0d8502-fa83-4747')
  })

  it('tolerates a trailing slash', () => {
    expect(reviewIdFromLink('yart://reviews/abc/')).toBe('abc')
  })

  it('ignores links to anything but a review', () => {
    expect(reviewIdFromLink('yart://settings/abc')).toBeNull()
    expect(reviewIdFromLink('yart://reviews/')).toBeNull()
    expect(reviewIdFromLink('https://reviews/abc')).toBeNull()
    expect(reviewIdFromLink('not a link')).toBeNull()
  })

  it('refuses an id that could step outside the review page', () => {
    expect(reviewIdFromLink('yart://reviews/../../etc')).toBeNull()
    expect(reviewIdFromLink('yart://reviews/abc?x=1')).toBe('abc')
    expect(reviewIdFromLink('yart://reviews/a%2F..%2Fb')).toBeNull()
  })
})
