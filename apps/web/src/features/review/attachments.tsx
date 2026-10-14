import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Attachment } from '@yart/core'
import { Button } from '@/components/button'
import { describeQueryError, type QueryError } from './query-error'
import { attachmentUrl, useUploadAttachmentMutation } from './review-api'
import styles from './attachments.module.css'

const IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/** The daemon refuses a larger image. The page tells it before the upload. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** The ids that a request sends. Nothing when there are no images. */
export const attachmentIds = (
  attachments: readonly Attachment[] | undefined,
): string[] | undefined =>
  attachments === undefined || attachments.length === 0
    ? undefined
    : attachments.map((attachment) => attachment.id)

const isImage = (file: File): boolean => IMAGE_TYPES.has(file.type)

const readBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? (reader.result.split(',')[1] ?? '') : '')
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'))
    reader.readAsDataURL(file)
  })

/**
 * The images of a comment that you write. Each image goes to the daemon when
 * you add it. The comment then sends only the ids.
 */
export const useImageAttachments = (review_id: string, initial: readonly Attachment[] = []) => {
  const [attachments, setAttachments] = useState<Attachment[]>([...initial])
  const [uploads, setUploads] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [upload] = useUploadAttachmentMutation()

  const add = async (files: readonly File[]) => {
    setError(null)
    for (const file of files.filter(isImage)) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`${file.name} is larger than 5 MB.`)
        continue
      }
      setUploads((count) => count + 1)
      try {
        const attachment = await upload({ review_id, data: await readBase64(file) }).unwrap()
        setAttachments((current) =>
          current.some((existing) => existing.id === attachment.id)
            ? current
            : [...current, attachment],
        )
      } catch (cause) {
        setError(describeQueryError(cause as QueryError).message)
      } finally {
        setUploads((count) => count - 1)
      }
    }
  }

  // A paste or a drop with no image keeps its usual behavior, such as text.
  const take = (files: readonly File[], event: { preventDefault: () => void }) => {
    if (!files.some(isImage)) return
    event.preventDefault()
    void add(files)
  }

  return {
    attachments,
    uploading: uploads > 0,
    error,
    add,
    remove: (id: string) => setAttachments((current) => current.filter((item) => item.id !== id)),
    clear: () => setAttachments([]),
    onPaste: (event: ClipboardEvent<HTMLElement>) => take([...event.clipboardData.files], event),
    onDrop: (event: DragEvent<HTMLElement>) => take([...event.dataTransfer.files], event),
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    },
  }
}

export interface AttachButtonProps {
  disabled?: boolean
  onFiles: (files: File[]) => void
}

/** Opens the file picker for images. */
export const AttachButton = ({ disabled = false, onFiles }: AttachButtonProps) => {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={[...IMAGE_TYPES].join(',')}
        multiple
        hidden
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
      <Button tone="quiet" disabled={disabled} onClick={() => input.current?.click()}>
        Attach image
      </Button>
    </>
  )
}

interface ImageViewerProps {
  src: string | null
  onClose: () => void
}

/** The full image, in a modal dialog. A click or Escape closes it. */
const ImageViewer = ({ src, onClose }: ImageViewerProps) => {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (src !== null && !element.open) element.showModal()
    if (src === null && element.open) element.close()
  }, [src])

  return (
    <dialog
      ref={dialog}
      className={styles.viewer}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={onClose}
    >
      {src !== null && <img className={styles.full} src={src} alt="Attached image" />}
    </dialog>
  )
}

export interface AttachmentListProps {
  review_id: string
  attachments: readonly Attachment[] | undefined
  /** When it is given, each image gets a button that removes it. */
  onRemove?: (id: string) => void
}

/** The images of a comment, as thumbnails. A click shows the full image. */
export const AttachmentList = ({ review_id, attachments, onRemove }: AttachmentListProps) => {
  const [open, setOpen] = useState<string | null>(null)
  if (attachments === undefined || attachments.length === 0) return null

  return (
    <div className={styles.list}>
      {attachments.map((attachment) => {
        const src = attachmentUrl(review_id, attachment.id)
        return (
          <div key={attachment.id} className={styles.item}>
            <button
              type="button"
              className={styles.thumbnail_button}
              aria-label="Show the full image"
              onClick={() => setOpen(src)}
            >
              <img className={styles.thumbnail} src={src} alt="Attached image" />
            </button>
            {onRemove !== undefined && (
              <button
                type="button"
                className={styles.remove}
                aria-label="Remove the image"
                onClick={() => onRemove(attachment.id)}
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      <ImageViewer src={open} onClose={() => setOpen(null)} />
    </div>
  )
}
