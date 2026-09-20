import { configureStore } from '@reduxjs/toolkit';
import diffViewReducer from '@/features/diff/diffViewSlice';

export const store = configureStore({
  reducer: {
    diffView: diffViewReducer,
  },
});

export type AppStore = typeof store;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
