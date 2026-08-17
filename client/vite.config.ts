import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config'

// The dev/preview proxy table is shared: `vite preview` does not inherit `server.proxy`,
// and the e2e `pwa` project drives a production build on :4173 against the same API
// server on :3001 the rest of the suite uses.
const proxy = {
  '/api': 'http://localhost:3001',
  // Static illustration assets are written by the Express server under its
  // /public dir and referenced as server-relative paths (api() returns them
  // as-is in dev). Without this, /illustrations/* would hit Vite and fall
  // through to index.html, so generated images render broken in local dev.
  '/illustrations': 'http://localhost:3001',
}

export default defineConfig({
  // Subpath prefix for built assets; defaults to '/' for local dev.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
})
