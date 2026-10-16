import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // The daemon uses port 7777, and serves the built UI from there. During
    // development, Vite runs next to it and sends the API requests to it.
    // `pnpm dev:actual` runs its own daemon on a different port, and gives that
    // port here.
    port: 5173,
    // Open the UI on http://yart-5173.localhost:5173, not on `localhost`. The
    // cookie of the person belongs to the name in the address bar. Vite allows
    // each name under `.localhost`. The proxy keeps the name in `Host`, thus the
    // daemon accepts it. The sign-in link sets the cookie of the window, thus it
    // also goes to the daemon. The daemon answers on 127.0.0.1, not on `localhost`.
    proxy: {
      '/api': `http://127.0.0.1:${process.env.YART_DAEMON_PORT ?? '7777'}`,
      '/sign-in': `http://127.0.0.1:${process.env.YART_DAEMON_PORT ?? '7777'}`,
    },
  },
})
