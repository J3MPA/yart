import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

/** How hunks are laid out: one column with markers, or old/new side by side. */
export type DiffLayout = 'unified' | 'split';

export interface DiffViewState {
  layout: DiffLayout;
  /** Collapse runs of unchanged lines between hunks. */
  hideUnchanged: boolean;
}

const initialState: DiffViewState = {
  layout: 'unified',
  hideUnchanged: true,
};

const diffViewSlice = createSlice({
  name: 'diffView',
  initialState,
  reducers: {
    layoutChanged(state, action: PayloadAction<DiffLayout>) {
      state.layout = action.payload;
    },
    hideUnchangedToggled(state) {
      state.hideUnchanged = !state.hideUnchanged;
    },
  },
});

export const { layoutChanged, hideUnchangedToggled } = diffViewSlice.actions;
export default diffViewSlice.reducer;
