import { describe, it, expect, vi } from 'vitest'
import { isReload, startReloadsAtTop, type ReloadWindow } from '../reloadScroll'

function fakeWindow(opts: { type?: string; hash?: string; noPerformance?: boolean } = {}) {
  const listeners: Partial<Record<string, () => void>> = {}
  const history = {
    state: { usr: null, key: 'default', idx: 0 },
    scrollRestoration: 'auto' as ScrollRestoration,
    replaceState: vi.fn(),
  }
  const win = {
    location: { pathname: '/storybook/', search: '?q=luna', hash: opts.hash ?? '' },
    history,
    addEventListener: vi.fn((name: string, fn: () => void) => { listeners[name] = fn }),
    setTimeout: vi.fn((fn: () => void) => { fn(); return 0 }),
    performance: opts.noPerformance
      ? undefined
      : { getEntriesByType: vi.fn(() => (opts.type ? [{ type: opts.type }] : [])) },
  }
  return { win: win as unknown as ReloadWindow, history, listeners }
}

describe('reloadScroll', () => {
  it('recognises a reload, and nothing else', () => {
    expect(isReload(fakeWindow({ type: 'reload' }).win)).toBe(true)
    expect(isReload(fakeWindow({ type: 'navigate' }).win)).toBe(false)
    expect(isReload(fakeWindow({ type: 'back_forward' }).win)).toBe(false)
    expect(isReload(fakeWindow().win)).toBe(false)
    expect(isReload(fakeWindow({ noPerformance: true }).win)).toBe(false)
  })

  it('on a reload of /#browse, drops the hash and keeps the router state and query', () => {
    const { win, history } = fakeWindow({ type: 'reload', hash: '#browse' })

    startReloadsAtTop(win)

    expect(history.replaceState).toHaveBeenCalledWith(history.state, '', '/storybook/?q=luna')
  })

  it('on a reload, turns scroll restoration off until the page has loaded', () => {
    const { win, history, listeners } = fakeWindow({ type: 'reload' })

    startReloadsAtTop(win)

    expect(history.replaceState).not.toHaveBeenCalled()
    expect(history.scrollRestoration).toBe('manual')
    listeners.load?.()
    expect(history.scrollRestoration).toBe('auto')
  })

  it('leaves a fresh visit alone, so a shared /#browse link still lands on the section', () => {
    const { win, history } = fakeWindow({ type: 'navigate', hash: '#browse' })

    startReloadsAtTop(win)

    expect(history.replaceState).not.toHaveBeenCalled()
    expect(history.scrollRestoration).toBe('auto')
  })
})
