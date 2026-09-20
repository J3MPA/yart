import { describe, expect, it } from 'vitest'
import { relativeTime, shortSha } from './format'

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
