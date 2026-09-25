/* eslint-disable @typescript-eslint/naming-convention -- an environment
   variable's name is the operating system's shape, not this project's. */
import { describe, expect, it } from 'vitest'
import { browserOpeningEnabled } from './open-browser.ts'

describe('browserOpeningEnabled', () => {
  it('is on when nothing is set, so the loop works without configuration', () => {
    expect(browserOpeningEnabled({})).toBe(true)
  })

  it('is off when YART_NO_BROWSER is set to anything meaningful', () => {
    expect(browserOpeningEnabled({ YART_NO_BROWSER: '1' })).toBe(false)
    expect(browserOpeningEnabled({ YART_NO_BROWSER: 'true' })).toBe(false)
    expect(browserOpeningEnabled({ YART_NO_BROWSER: 'yes' })).toBe(false)
  })

  it('treats the usual ways of saying "no, leave it on" as leaving it on', () => {
    expect(browserOpeningEnabled({ YART_NO_BROWSER: '0' })).toBe(true)
    expect(browserOpeningEnabled({ YART_NO_BROWSER: 'false' })).toBe(true)
    expect(browserOpeningEnabled({ YART_NO_BROWSER: 'False' })).toBe(true)
    expect(browserOpeningEnabled({ YART_NO_BROWSER: '' })).toBe(true)
  })
})
