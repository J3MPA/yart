import { describe, expect, it } from 'vitest'
import { MAX_UNSENT, unsentKey, withUnsent } from './unsent'

const text = (body: string) => ({ body, attachments: [] })

describe('withUnsent', () => {
  it('keeps a text, and removes it when it is empty', () => {
    const key = unsentKey('r1', 'reply t1')
    const kept = withUnsent({}, key, text('a long comment'))
    expect(kept[key]?.body).toBe('a long comment')
    expect(withUnsent(kept, key, text('  '))).toEqual({})
    expect(withUnsent(kept, key, null)).toEqual({})
  })

  it('keeps a text with only images', () => {
    const unsent = { body: '', attachments: [{ id: 'i', media_type: 'image/png' as const }] }
    expect(withUnsent({}, 'k', unsent)).toEqual({ k: unsent })
  })

  it('removes the oldest text when it has too many', () => {
    let store = {}
    for (let index = 0; index <= MAX_UNSENT; index += 1) {
      store = withUnsent(store, `k${index}`, text(`t${index}`))
    }
    const keys = Object.keys(store)
    expect(keys).toHaveLength(MAX_UNSENT)
    expect(keys).not.toContain('k0')
    expect(keys).toContain(`k${MAX_UNSENT}`)
  })

  it('moves a text that changes to the end, thus it stays longest', () => {
    const store = withUnsent(withUnsent({}, 'a', text('1')), 'b', text('2'))
    expect(Object.keys(withUnsent(store, 'a', text('3')))).toEqual(['b', 'a'])
  })
})
