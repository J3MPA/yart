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
    proxy: {
      '/api': `http://localhost:${process.env.YART_DAEMON_PORT ?? '7777'}`,
    },
  },
})
