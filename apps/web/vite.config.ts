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
    // The daemon owns 7777 and serves the built UI from there; in development
    // Vite sits beside it and proxies the API across.
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7777',
    },
  },
})
