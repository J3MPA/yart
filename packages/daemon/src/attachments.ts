import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Attachment, ImageType } from '@yart/core'
import { findGitCommonDir } from './git.ts'
import { ReviewError } from './review-error.ts'

/** The largest image that a comment can have, in bytes. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

const EXTENSIONS: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const ID_PATTERN = /^[0-9a-f]{64}$/

/**
 * Tells the type of an image from its first bytes. The daemon sends each image
 * with its type. Thus the bytes must agree with the type, and a file that is
 * not an image does not go out as an image.
 */
export const sniffImageType = (data: Uint8Array): ImageType | null => {
  const starts = (bytes: readonly number[], offset = 0) =>
    bytes.every((byte, index) => data[offset + index] === byte)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

/**
 * The images of the comments of one repository. They are in the git directory,
 * next to the reviews, with one directory for each review. Thus a deletion of a
 * review removes its images.
 */
export class AttachmentStore {
  private readonly repo_path: string
  private resolved_dir: string | null

  constructor(repo_path: string) {
    this.repo_path = repo_path
    this.resolved_dir = null
  }

  private async dir(review_id: string): Promise<string> {
    this.resolved_dir ??= join(await findGitCommonDir(this.repo_path), 'yart', 'attachments')
    return join(this.resolved_dir, review_id)
  }

  /** Keeps an image, and returns its attachment. The same image twice gives the same attachment. */
  async save(review_id: string, data: Uint8Array): Promise<Attachment> {
    if (data.byteLength === 0) throw new ReviewError('The image is empty', 400)
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new ReviewError(`An image can be ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB at most`, 413)
    }
    const media_type = sniffImageType(data)
    if (media_type === null) {
      throw new ReviewError('The image must be a PNG, JPEG, WebP or GIF file', 415)
    }
    const id = createHash('sha256').update(data).digest('hex')
    const dir = await this.dir(review_id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${id}.${EXTENSIONS[media_type]}`), data)
    return { id, media_type }
  }

  /** Reads an image of a review, or returns null when the review has no such image. */
  async read(
    review_id: string,
    id: string,
  ): Promise<{ data: Buffer; media_type: ImageType } | null> {
    if (!ID_PATTERN.test(id)) return null
    const dir = await this.dir(review_id)
    for (const [media_type, extension] of Object.entries(EXTENSIONS) as [ImageType, string][]) {
      const data = await readFile(join(dir, `${id}.${extension}`)).catch(() => null)
      if (data !== null) return { data, media_type }
    }
    return null
  }

  /**
   * The attachments for a list of ids. Each id must be an image that the review
   * has. Thus a comment cannot point to an image that does not exist.
   */
  async resolve(review_id: string, ids: readonly string[] | undefined): Promise<Attachment[]> {
    const attachments: Attachment[] = []
    for (const id of new Set(ids ?? [])) {
      const found = await this.read(review_id, id)
      if (found === null) throw new ReviewError(`This review has no image with id ${id}`, 400)
      attachments.push({ id, media_type: found.media_type })
    }
    return attachments
  }

  async removeAll(review_id: string): Promise<void> {
    await rm(await this.dir(review_id), { recursive: true, force: true })
  }
}
