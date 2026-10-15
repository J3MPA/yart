import { createSlice } from '@reduxjs/toolkit'

/**
 * Tells if the daemon refused the sign-in of this window.
 *
 * The window signs in with a one-time link, and gets a cookie. The daemon makes
 * a new secret when it starts again. Then the cookie does not work, and the
 * window must sign in again.
 */
const session_slice = createSlice({
  name: 'session',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Redux Toolkit's option name
  initialState: { signed_out: false },
  reducers: {
    signedOut(state) {
      state.signed_out = true
    },
  },
})

export const { signedOut } = session_slice.actions
export default session_slice.reducer
