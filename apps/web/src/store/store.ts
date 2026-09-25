import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import diffViewReducer from '@/features/diff/diff-view-slice'
import seenReducer from '@/features/review/seen-slice'
import { reviewApi } from '@/features/review/review-api'
import { writeSeen } from '@/features/review/seen-reviews'

export const Store = configureStore({
  reducer: {
    diff_view: diffViewReducer,
    seen: seenReducer,
    [reviewApi.reducerPath]: reviewApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(reviewApi.middleware),
})

// Required for refetchOnFocus/refetchOnReconnect to fire.
setupListeners(Store.dispatch)

// Seen-ness is written back only when it actually changes. Subscribing to the
// whole store would otherwise write on every query the app makes.
let last_seen = Store.getState().seen
Store.subscribe(() => {
  const next = Store.getState().seen
  if (next === last_seen) return
  last_seen = next
  writeSeen(next)
})

export type AppStore = typeof Store
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
