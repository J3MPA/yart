import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

/** How hunks are laid out: one column with markers, or old/new side by side. */
export type DiffLayout = 'unified' | 'split';

export interface DiffViewState {
  layout: DiffLayout;
  /** Collapse runs of unchanged lines between hunks. */
  hide_unchanged: boolean;
}

const initial_state: DiffViewState = {
  layout: 'unified',
  hide_unchanged: true,
};

const diff_view_slice = createSlice({
  name: 'diff_view',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit's option name
  initialState: initial_state,
  reducers: {
    layoutChanged(state, action: PayloadAction<DiffLayout>) {
      state.layout = action.payload;
    },
    hideUnchangedToggled(state) {
      state.hide_unchanged = !state.hide_unchanged;
    },
  },
});

export const { layoutChanged, hideUnchangedToggled } = diff_view_slice.actions;
export default diff_view_slice.reducer;
