import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@yart/core'
import { SettingsStore } from './settings.ts'

let state_dir: string

beforeEach(() => {
  state_dir = mkdtempSync(join(tmpdir(), 'yart-settings-'))
})

afterEach(() => {
  rmSync(state_dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('keeps a change in its file, for the next daemon to read', async () => {
    await new SettingsStore(state_dir).update({ on_approve: 'delete' })
    expect((await new SettingsStore(state_dir).read()).on_approve).toBe('delete')
    expect(readFileSync(join(state_dir, 'settings.json'), 'utf8')).toContain('"delete"')
  })

  it('reads a missing or broken file as the defaults', async () => {
    expect(await new SettingsStore(state_dir).read()).toEqual(DEFAULT_SETTINGS)
    writeFileSync(join(state_dir, 'settings.json'), '{ not json')
    expect(await new SettingsStore(state_dir).read()).toEqual(DEFAULT_SETTINGS)
  })

  it('reads a value it does not know as the default', async () => {
    writeFileSync(
      join(state_dir, 'settings.json'),
      JSON.stringify({ on_approve: 'shred', ai_review_rounds: 99 }),
    )
    expect(await new SettingsStore(state_dir).read()).toEqual(DEFAULT_SETTINGS)
  })
})
