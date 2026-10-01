export type SelectionState = 'none' | 'some' | 'all'

/** Which reviews are ticked in the list. */
export type Selection = ReadonlySet<string>

export const toggleSelected = (selection: Selection, review_id: string): Selection => {
  const next = new Set(selection)
  if (next.has(review_id)) next.delete(review_id)
  else next.add(review_id)
  return next
}

/** How much of the list is ticked, for the box that ticks all of it. */
export const selectionState = (selection: Selection, ids: readonly string[]): SelectionState => {
  const ticked = ids.filter((id) => selection.has(id)).length
  if (ticked === 0) return 'none'
  return ticked === ids.length ? 'all' : 'some'
}

/** Ticks every review in the list, or clears them all when they already are. */
export const toggleAll = (selection: Selection, ids: readonly string[]): Selection =>
  selectionState(selection, ids) === 'all' ? new Set() : new Set(ids)

/**
 * Drops reviews that have left the list — deleted, archived elsewhere, or
 * moved to the other tab — so an action never reaches one nobody can see.
 */
export const keepListed = (selection: Selection, ids: readonly string[]): Selection => {
  const listed = ids.filter((id) => selection.has(id))
  return listed.length === selection.size ? selection : new Set(listed)
}
