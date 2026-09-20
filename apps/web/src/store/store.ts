import { configureStore } from '@reduxjs/toolkit'
import diffViewReducer from '@/features/diff/diff-view-slice'

export const Store = configureStore({
  reducer: {
    diff_view: diffViewReducer,
  },
})

export type AppStore = typeof Store
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
