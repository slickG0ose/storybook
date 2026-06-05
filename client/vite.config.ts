import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Subpath prefix for built assets; defaults to '/' for local dev.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      // Static illustration assets are written by the Express server under its
      // /public dir and referenced as server-relative paths (api() returns them
      // as-is in dev). Without this, /illustrations/* would hit Vite and fall
      // through to index.html, so generated images render broken in local dev.
      '/illustrations': 'http://localhost:3001',
    },
  },
})
