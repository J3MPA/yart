import { createThread, type Comment, type Thread } from '@yart/core'
import { describe, expect, it } from 'vitest'
import { openThreads, renderThread, renderThreads } from './render.ts'

const COMMENT: Comment = {
  id: 'c1',
  author: 'human',
  body: 'this needs a null check',
  created_at: '2026-09-20T12:00:00.000Z',
}

const CONTENT = 'const a = 1;\nconst b = 2;\nconst c = 3;\n'

const threadAt = (line: number): Thread =>
  createThread({
    id: 't-abc',
    anchor: { path: 'src/a.ts', blob_sha: 'blob1', line, side: 'head' },
    content: CONTENT,
    comment: COMMENT,
  })

describe('renderThread', () => {
  it('shows the id, location and comment', () => {
    const rendered = renderThread(threadAt(2))
    expect(rendered).toContain('[t-abc] src/a.ts:2')
    expect(rendered).toContain('human: this needs a null check')
  })

  it('marks the commented line within its context', () => {
    const rendered = renderThread(threadAt(2))
    expect(rendered).toContain('  >   const b = 2;')
    expect(rendered).toContain('      const a = 1;')
    expect(rendered).toContain('      const c = 3;')
  })

  it('reports where a shifted thread came from', () => {
    const thread = threadAt(2)
    const shifted: Thread = {
      ...thread,
      anchor: { ...thread.origin, line: 9 },
      anchor_state: 'shifted',
    }
    expect(renderThread(shifted)).toContain('src/a.ts:9  (moved from src/a.ts:2)')
  })

  it('flags an outdated thread and still shows what it referred to', () => {
    const thread = threadAt(2)
    const outdated: Thread = { ...thread, anchor: null, anchor_state: 'outdated' }
    const rendered = renderThread(outdated)
    expect(rendered).toContain('[OUTDATED')
    expect(rendered).toContain('const b = 2;')
  })

  it('marks a resolved thread', () => {
    const resolved: Thread = { ...threadAt(2), status: 'resolved' }
    expect(renderThread(resolved)).toContain('[resolved]')
  })

  it('shows every comment in order', () => {
    const thread = threadAt(2)
    const replied: Thread = {
      ...thread,
      comments: [
        ...thread.comments,
        { id: 'c2', author: 'agent', body: 'added one', created_at: '2026-09-20T12:05:00.000Z' },
      ],
    }
    const rendered = renderThread(replied)
    expect(rendered.indexOf('human:')).toBeLessThan(rendered.indexOf('agent:'))
  })
})

describe('renderThreads', () => {
  it('says so when there is nothing', () => {
    expect(renderThreads([], 'Open comments')).toBe('Open comments: none.')
  })

  it('counts what it renders', () => {
    expect(renderThreads([threadAt(1), threadAt(2)], 'Open comments')).toContain(
      'Open comments (2):',
    )
  })
})

describe('openThreads', () => {
  it('keeps only unresolved threads', () => {
    const review = {
      threads: [threadAt(1), { ...threadAt(2), id: 't-done', status: 'resolved' as const }],
    }
    expect(openThreads(review as never).map((thread) => thread.id)).toEqual(['t-abc'])
  })
})
