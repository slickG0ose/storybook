// API base URL, configured at Vite build time via VITE_API_BASE_URL.
// Default empty string keeps relative paths in local dev (Vite proxy
// in vite.config.ts routes /api to localhost:3001). Production builds
// inject the server origin so fetches go cross-origin.
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export function api(path: string): string {
  return `${API_BASE}${path}`
}
