import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config'
import { ogAbsoluteUrls } from './og.config'

// Ports are env-overridable so a second checkout can run its dev servers and its e2e
// suite without colliding with the one that already owns 3001/5173/4173 (#130). The
// defaults are the ports that were hardcoded here before, so `npm run dev` and CI are
// unchanged; e2e/ports.ts reads the same three names and forwards them to Vite.
const API_PORT = process.env.API_PORT ?? '3001'
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173)
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? 4173)

// The dev/preview proxy table is shared: `vite preview` does not inherit `server.proxy`,
// and the e2e `pwa` project drives a production build on the preview port against the
// same API server the rest of the suite uses.
const API_ORIGIN = `http://localhost:${API_PORT}`

const proxy = {
  '/api': API_ORIGIN,
  // Static illustration assets are written by the Express server under its
  // /public dir and referenced as server-relative paths (api() returns them
  // as-is in dev). Without this, /illustrations/* would hit Vite and fall
  // through to index.html, so generated images render broken in local dev.
  '/illustrations': API_ORIGIN,
  // Same story for the derived hero-rotation frames: `api('/hero/<book>/p1-960.webp')`
  // is server-relative in dev, so without this the rotating layer would load Vite's
  // index.html, fire `onerror`, and the pool would silently skip every frame.
  '/hero': API_ORIGIN,
}

export default defineConfig({
  // Subpath prefix for built assets; defaults to '/' for local dev.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions), ogAbsoluteUrls()],
  server: {
    port: CLIENT_PORT,
    proxy,
  },
  preview: {
    port: PREVIEW_PORT,
    proxy,
  },
})
