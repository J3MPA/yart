import { describe, expect, it } from 'vitest'
import { attachmentIds } from './attachments'

describe('attachmentIds', () => {
  it('sends the ids of the images', () => {
    expect(attachmentIds([{ id: 'a', media_type: 'image/png' }])).toEqual(['a'])
  })

  it('sends nothing for a comment with no images', () => {
    expect(attachmentIds([])).toBe(undefined)
    expect(attachmentIds(undefined)).toBe(undefined)
  })
})
