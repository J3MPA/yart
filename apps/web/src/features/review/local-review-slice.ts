import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { readStored } from './browser-storage'
import {
  addDraft,
  clearDrafts,
  forgetDeleted,
  removeDraft,
  setReviewed,
  toggleFolded,
  updateDraft,
  type Draft,
  type LocalReviews,
} from './local-review-state'

export const LOCAL_REVIEWS_KEY = 'yart.local-reviews.v1'

const local_review_slice = createSlice({
  name: 'local_reviews',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit's option name
  initialState: readStored<LocalReviews>(LOCAL_REVIEWS_KEY, {}),
  reducers: {
    directoryToggled(state, action: PayloadAction<{ review_id: string; path: string }>) {
      return toggleFolded(state, action.payload.review_id, action.payload.path)
    },
    fileReviewedSet(
      state,
      action: PayloadAction<{ review_id: string; path: string; blob_sha: string | null }>,
    ) {
      const { review_id, path, blob_sha } = action.payload
      return setReviewed(state, review_id, path, blob_sha)
    },
    draftAdded(state, action: PayloadAction<{ review_id: string; draft: Draft }>) {
      return addDraft(state, action.payload.review_id, action.payload.draft)
    },
    draftEdited(
      state,
      action: PayloadAction<{ review_id: string; draft_id: string; body: string }>,
    ) {
      const { review_id, draft_id, body } = action.payload
      return updateDraft(state, review_id, draft_id, body)
    },
    draftDropped(state, action: PayloadAction<{ review_id: string; draft_id: string }>) {
      return removeDraft(state, action.payload.review_id, action.payload.draft_id)
    },
    draftsSent(state, action: PayloadAction<string>) {
      return clearDrafts(state, action.payload)
    },
    deletedReviewsForgotten(state, action: PayloadAction<readonly string[]>) {
      const next = forgetDeleted(state, action.payload)
      // The same object back when nothing was dropped, so a poll that changes
      // nothing does not re-render or rewrite storage.
      return Object.keys(next).length === Object.keys(state).length ? state : next
    },
  },
})

export const {
  directoryToggled,
  fileReviewedSet,
  draftAdded,
  draftEdited,
  draftDropped,
  draftsSent,
  deletedReviewsForgotten,
} = local_review_slice.actions
export default local_review_slice.reducer
