/* eslint-disable @typescript-eslint/naming-convention -- environment variable names */
import { describe, expect, it } from 'vitest'
import { readConfig } from './config.ts'

describe('readConfig', () => {
  it('opens the daemon on its default port when told nothing', () => {
    expect(readConfig({})).toEqual({
      start_url: 'http://localhost:7777/',
      origin: 'http://localhost:7777',
      profile: null,
    })
  })

  it('opens the page it is given and stays on that page’s origin', () => {
    const config = readConfig({ YART_START_URL: 'http://localhost:5173/reviews/abc' })
    expect(config.start_url).toBe('http://localhost:5173/reviews/abc')
    expect(config.origin).toBe('http://localhost:5173')
  })

  it('keeps a development shell in a profile of its own', () => {
    expect(readConfig({ YART_DEV: '1' }).profile).toBe('yart-dev')
  })
})
