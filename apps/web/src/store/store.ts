import { configureStore } from '@reduxjs/toolkit'
import diffViewReducer from '@/features/diff/diff-view-slice'
import { reviewApi } from '@/features/review/review-api'

export const Store = configureStore({
  reducer: {
    diff_view: diffViewReducer,
    [reviewApi.reducerPath]: reviewApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(reviewApi.middleware),
})

export type AppStore = typeof Store
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
