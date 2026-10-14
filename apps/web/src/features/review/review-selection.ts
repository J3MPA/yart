export type SelectionState = 'none' | 'some' | 'all'

/** The reviews that are selected in the list. */
export type Selection = ReadonlySet<string>

export const toggleSelected = (selection: Selection, review_id: string): Selection => {
  const next = new Set(selection)
  if (next.has(review_id)) next.delete(review_id)
  else next.add(review_id)
  return next
}

/** How much of the list is selected, for the box that selects all of it. */
export const selectionState = (selection: Selection, ids: readonly string[]): SelectionState => {
  const ticked = ids.filter((id) => selection.has(id)).length
  if (ticked === 0) return 'none'
  return ticked === ids.length ? 'all' : 'some'
}

/** Selects all reviews in the list, or clears them all when all are already selected. */
export const toggleAll = (selection: Selection, ids: readonly string[]): Selection =>
  selectionState(selection, ids) === 'all' ? new Set() : new Set(ids)

/**
 * Removes the reviews that left the list. They can be deleted, archived in a
 * different place, or in the other tab. Thus an action never touches a review
 * that nobody can see.
 */
export const keepListed = (selection: Selection, ids: readonly string[]): Selection => {
  const listed = ids.filter((id) => selection.has(id))
  return listed.length === selection.size ? selection : new Set(listed)
}
