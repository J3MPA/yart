import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { KeyedQueue, writeFileAtomic } from './serial.ts'

describe('KeyedQueue', () => {
  it('runs the tasks of one key one after the other', async () => {
    const queue = new KeyedQueue()
    const events: string[] = []
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`)
      await delay(ms)
      events.push(`end ${name}`)
      return name
    }
    const results = await Promise.all([
      queue.run('a', task('one', 30)),
      queue.run('a', task('two', 1)),
    ])
    expect(results).toEqual(['one', 'two'])
    expect(events).toEqual(['start one', 'end one', 'start two', 'end two'])
  })

  it('runs the tasks of different keys at the same time', async () => {
    const queue = new KeyedQueue()
    const events: string[] = []
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`)
      await delay(ms)
      events.push(`end ${name}`)
    }
    await Promise.all([queue.run('a', task('a', 30)), queue.run('b', task('b', 1))])
    expect(events).toEqual(['start a', 'start b', 'end b', 'end a'])
  })

  it('continues with the next task after a task fails', async () => {
    const queue = new KeyedQueue()
    const failed = queue.run('a', () => Promise.reject(new Error('no')))
    const next = queue.run('a', () => Promise.resolve('yes'))
    await expect(failed).rejects.toThrow('no')
    await expect(next).resolves.toBe('yes')
  })
})

describe('writeFileAtomic', () => {
  it('writes the full content of each writer, and leaves no temporary file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yart-atomic-'))
    try {
      const path = join(dir, 'file.json')
      const contents = Array.from({ length: 20 }, (_, index) => `${String(index).repeat(5000)}\n`)
      await Promise.all(contents.map((content) => writeFileAtomic(path, content)))
      expect(contents).toContain(readFileSync(path, 'utf8'))
      expect(readdirSync(dir)).toEqual(['file.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
