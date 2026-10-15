import { describe, expect, it } from 'vitest'
import { AttachmentStore, sniffImageType } from './attachments.ts'
import { ReviewStore } from './store.ts'
import { TestRepo } from './test-repo.ts'

describe('sniffImageType', () => {
  it('tells each image type from its first bytes', () => {
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    )
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageType(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
  })

  it('refuses other files', () => {
    expect(sniffImageType(Buffer.from('<svg/>'))).toBe(null)
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBe(null)
  })
})

describe('the stores', () => {
  it('refuse a review id that is not a UUID, before they touch the disk', async () => {
    const repo = new TestRepo()
    try {
      const attachments = new AttachmentStore(repo.path)
      const reviews = new ReviewStore(repo.path)
      for (const id of ['../../../../outside', 'a/b', '..', '']) {
        await expect(attachments.removeAll(id)).rejects.toThrow(/No review/)
        await expect(reviews.remove(id)).rejects.toThrow(/No review/)
        expect(await reviews.load(id)).toBe(null)
      }
    } finally {
      repo.dispose()
    }
  })
})
