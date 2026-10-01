import { describe, expect, it } from 'vitest'
import { keepListed, selectionState, toggleAll, toggleSelected } from './review-selection'

const IDS = ['a', 'b', 'c']

describe('toggleSelected', () => {
  it('ticks a review, and unticks it again', () => {
    const ticked = toggleSelected(new Set(), 'a')
    expect([...ticked]).toEqual(['a'])
    expect([...toggleSelected(ticked, 'a')]).toEqual([])
  })
})

describe('selectionState', () => {
  it('says whether none, some or all of the list is ticked', () => {
    expect(selectionState(new Set(), IDS)).toBe('none')
    expect(selectionState(new Set(['b']), IDS)).toBe('some')
    expect(selectionState(new Set(IDS), IDS)).toBe('all')
  })

  it('calls an empty list unticked', () => {
    expect(selectionState(new Set(), [])).toBe('none')
  })
})

describe('toggleAll', () => {
  it('ticks everything when anything is left unticked', () => {
    expect([...toggleAll(new Set(['a']), IDS)]).toEqual(IDS)
  })

  it('clears everything when it is all ticked', () => {
    expect([...toggleAll(new Set(IDS), IDS)]).toEqual([])
  })
})

describe('keepListed', () => {
  it('drops reviews no longer in the list', () => {
    expect([...keepListed(new Set(['a', 'gone']), IDS)]).toEqual(['a'])
  })

  it('hands back the same selection when nothing left', () => {
    const selection = new Set(['a', 'b'])
    expect(keepListed(selection, IDS)).toBe(selection)
  })
})
