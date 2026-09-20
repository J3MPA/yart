import { Hono } from 'hono'
import type { CommentAuthor, DiffSide, Thread } from '@yart/core'
import { GitError, readBlob } from './git.ts'
import { ReviewError, ReviewService } from './review.ts'

export interface ServerOptions {
  repo_path: string
}

interface ErrorBody {
  error: string
}

const statusFor = (cause: unknown): number => {
  if (cause instanceof ReviewError) return cause.status
  // A git failure here means a revision or path the caller named does not
  // exist, which is their mistake rather than the daemon's.
  if (cause instanceof GitError) return 400
  return 500
}

const messageFor = (cause: unknown): string => {
  return cause instanceof Error ? cause.message : 'Unexpected error'
}

export const createServer = ({ repo_path }: ServerOptions): Hono => {
  const service = new ReviewService(repo_path)
  const app = new Hono()

  app.onError((cause, context) => {
    const status = statusFor(cause)
    if (status === 500) console.error(cause)
    return context.json<ErrorBody>({ error: messageFor(cause) }, status as 400)
  })

  app.get('/health', (context) => context.json({ ok: true, repo_path }))

  app.get('/api/reviews', async (context) => context.json(await service.list()))

  app.post('/api/reviews', async (context) => {
    const body = await context.req.json<{ base?: string; head?: string }>()
    if (typeof body.base !== 'string' || body.base === '') {
      throw new ReviewError('A base revision is required', 400)
    }
    const review = await service.create({
      repo_path,
      base: body.base,
      head: body.head,
    })
    return context.json(review, 201)
  })

  app.get('/api/reviews/:id', async (context) =>
    context.json(await service.get(context.req.param('id'))),
  )

  app.delete('/api/reviews/:id', async (context) => {
    await service.remove(context.req.param('id'))
    return context.body(null, 204)
  })

  /**
   * Both sides of a file, for rendering. Path arrives as a query parameter
   * rather than a path segment so that nested paths need no encoding.
   */
  app.get('/api/reviews/:id/file', async (context) => {
    const review = await service.get(context.req.param('id'))
    const path = context.req.query('path')
    if (path === undefined) throw new ReviewError('A path is required', 400)

    const file = review.files.find((candidate) => candidate.path === path)
    if (file === undefined) throw new ReviewError(`${path} is not part of this review`, 404)

    const [base_content, head_content] = await Promise.all([
      file.base_blob_sha === null ? null : readBlob(review.repo_path, file.base_blob_sha),
      file.head_blob_sha === null ? null : readBlob(review.repo_path, file.head_blob_sha),
    ])

    return context.json({ ...file, base_content, head_content })
  })

  app.post('/api/reviews/:id/threads', async (context) => {
    const body = await context.req.json<{
      path?: string
      line?: number
      side?: DiffSide
      body?: string
      author?: CommentAuthor
    }>()

    if (typeof body.path !== 'string' || typeof body.line !== 'number') {
      throw new ReviewError('A path and a line are required', 400)
    }
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      throw new ReviewError('A comment body is required', 400)
    }

    const review = await service.addThread(context.req.param('id'), {
      path: body.path,
      line: body.line,
      side: body.side,
      body: body.body,
      author: body.author,
    })
    return context.json(review, 201)
  })

  app.post('/api/reviews/:id/threads/:thread_id/comments', async (context) => {
    const body = await context.req.json<{ body?: string; author?: CommentAuthor }>()
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      throw new ReviewError('A comment body is required', 400)
    }

    return context.json(
      await service.addComment(
        context.req.param('id'),
        context.req.param('thread_id'),
        body.body,
        body.author,
      ),
      201,
    )
  })

  app.patch('/api/reviews/:id/threads/:thread_id', async (context) => {
    const body = await context.req.json<{ status?: Thread['status'] }>()
    if (body.status !== 'open' && body.status !== 'resolved') {
      throw new ReviewError('Status must be "open" or "resolved"', 400)
    }

    return context.json(
      await service.setThreadStatus(
        context.req.param('id'),
        context.req.param('thread_id'),
        body.status,
      ),
    )
  })

  app.post('/api/reviews/:id/submit', async (context) =>
    context.json(await service.submit(context.req.param('id'))),
  )

  app.post('/api/reviews/:id/advance', async (context) => {
    const body = await context.req.json<{ head?: string }>().catch(() => ({ head: undefined }))
    return context.json(await service.advanceHead(context.req.param('id'), body.head ?? 'HEAD'))
  })

  return app
}
