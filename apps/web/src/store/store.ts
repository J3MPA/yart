import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import diffViewReducer from '@/features/diff/diff-view-slice'
import localReviewsReducer, { LOCAL_REVIEWS_KEY } from '@/features/review/local-review-slice'
import seenReducer from '@/features/review/seen-slice'
import { reviewApi } from '@/features/review/review-api'
import sessionReducer from '@/features/session/session-slice'
import { writeStored } from '@/features/review/browser-storage'
import { writeSeen } from '@/features/review/seen-reviews'

export const Store = configureStore({
  reducer: {
    diff_view: diffViewReducer,
    seen: seenReducer,
    local_reviews: localReviewsReducer,
    session: sessionReducer,
    [reviewApi.reducerPath]: reviewApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(reviewApi.middleware),
})

// refetchOnFocus and refetchOnReconnect need this to work.
setupListeners(Store.dispatch)

// Write the state of the person only when it changes. A subscription to all of
// the store would write on each query that the app makes.
let last_seen = Store.getState().seen
let last_local = Store.getState().local_reviews
Store.subscribe(() => {
  const { seen, local_reviews } = Store.getState()
  if (seen !== last_seen) {
    last_seen = seen
    writeSeen(seen)
  }
  if (local_reviews !== last_local) {
    last_local = local_reviews
    writeStored(LOCAL_REVIEWS_KEY, local_reviews)
  }
})

export type AppStore = typeof Store
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
