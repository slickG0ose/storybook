import { describe, it, expect } from 'vitest'
import { pwaOptions } from '../../pwa.config'

/**
 * Pins the manifest fields a production deploy would break silently on, without paying
 * for a full `vite build`. The base-path pair (`start_url` / `scope`) is the whole reason
 * pwa.config.ts is a standalone module: GitHub Pages serves this app under /storybook/,
 * and an absolute '/' boots the installed app straight to a 404 — a failure only visible
 * on a real deploy, which #77 currently makes unreachable.
 */
describe('pwaOptions', () => {
  const manifest = pwaOptions.manifest as Extract<typeof pwaOptions.manifest, { name?: string }>

  it('keeps start_url and scope base-relative, not absolute', () => {
    expect(manifest?.start_url).toBe('.')
    expect(manifest?.scope).toBe('.')
  })

  it('declares an installable standalone manifest', () => {
    expect(manifest).toMatchObject({
      name: 'StoryBook Storefront',
      short_name: 'StoryBook',
      display: 'standalone',
      background_color: '#fffbeb',
      theme_color: '#f59e0b',
    })
  })

  it('ships both an any and a maskable icon', () => {
    const icons = manifest?.icons ?? []
    expect(icons).toHaveLength(2)
    expect(icons.find(i => i.purpose === 'any')).toMatchObject({
      src: 'icons/icon.svg',
      type: 'image/svg+xml',
      sizes: 'any',
    })
    expect(icons.find(i => i.purpose === 'maskable')).toMatchObject({
      src: 'icons/maskable-icon.svg',
      type: 'image/svg+xml',
      sizes: 'any',
    })
  })

  it('prompts before reloading rather than auto-updating', () => {
    // autoUpdate reloads when the new worker takes control, which on /checkout with a
    // filled form discards user input. See UpdateToast.
    expect(pwaOptions.registerType).toBe('prompt')
  })

  it('keeps the service worker out of the dev server', () => {
    // The chromium / mobile-pixel / mobile-small e2e projects run against :5173. A worker
    // there would serve them stale precached assets.
    expect(pwaOptions.devOptions?.enabled).toBe(false)
  })

  it('precaches the hero image extension', () => {
    // Why the extension list matters: the Home hero is a bundled WebP rendered above the
    // fold. globPatterns IS the precache manifest — an extension absent from it is never
    // cached, so an offline Home renders a broken image box instead of the artwork.
    // Parsed rather than substring-matched so this fails if `webp` is dropped, and does
    // not fight a future addition (e.g. the deferred AVIF variants).
    const globPatterns = pwaOptions.workbox?.globPatterns ?? []
    const precachedExtensions = globPatterns.flatMap(
      pattern => pattern.match(/\{([^}]*)\}/)?.[1]?.split(',') ?? [],
    )
    expect(precachedExtensions).toContain('webp')
  })

  it('excludes /api/ and /illustrations/ from the navigation fallback', () => {
    const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? []
    expect(pwaOptions.workbox?.navigateFallback).toBe('index.html')
    expect(denylist.some(re => re.test('/api/cart/abc'))).toBe(true)
    expect(denylist.some(re => re.test('/illustrations/x.png'))).toBe(true)
    // ...but an in-app route must still fall back to the shell.
    expect(denylist.some(re => re.test('/checkout'))).toBe(false)
  })
})
