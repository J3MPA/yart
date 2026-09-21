import { describe, expect, it } from 'vitest'
import { activeFile } from './active-file'

const at = (path: string, top: number) => ({ path, top })

describe('activeFile', () => {
  it('names nothing when there are no files', () => {
    expect(activeFile([], 200)).toBeNull()
  })

  it('names the first file before any of them has reached the line', () => {
    expect(activeFile([at('a', 400), at('b', 900)], 200)).toBe('a')
  })

  it('names the last file to have started above the line', () => {
    expect(activeFile([at('a', -900), at('b', -100), at('c', 600)], 200)).toBe('b')
  })

  it('counts a file resting exactly on the line as started', () => {
    expect(activeFile([at('a', -100), at('b', 200)], 200)).toBe('b')
  })

  it('names the last file once everything is above the line', () => {
    expect(activeFile([at('a', -2000), at('b', -900), at('c', -100)], 200)).toBe('c')
  })
})
