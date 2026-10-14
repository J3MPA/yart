import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { forgetMissing, markSeen, readSeen } from './seen-reviews'

/**
 * The reviews that the person saw, and how much of each.
 *
 * This is in the store, not in each component. Three places need the same
 * answer: the list rows, the review page that clears it, and the tab title. Two
 * of them are never mounted at the same time.
 */
const seen_slice = createSlice({
  name: 'seen',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit's option name
  initialState: readSeen(),
  reducers: {
    reviewSeen(state, action: PayloadAction<{ review_id: string; activity: number }>) {
      const { review_id, activity } = action.payload
      const next = markSeen(state, review_id, activity)
      return next ?? state
    },
    missingForgotten(state, action: PayloadAction<readonly string[]>) {
      const next = forgetMissing(state, action.payload)
      // Return the same object when nothing was removed. Thus the store does not
      // notify, and the page does not render again on each poll.
      return Object.keys(next).length === Object.keys(state).length ? state : next
    },
  },
})

export const { reviewSeen, missingForgotten } = seen_slice.actions
export default seen_slice.reducer
