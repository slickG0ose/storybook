import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import UpdateToast from '../UpdateToast'

const updateServiceWorker = vi.fn().mockResolvedValue(undefined)
const setNeedRefresh = vi.fn()
let needRefresh = false

// Aliased to src/test/pwaRegisterStub.ts by vitest.config.ts so this specifier resolves
// outside a vite-plugin-pwa build.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker,
  }),
}))

describe('UpdateToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    needRefresh = false
  })

  it('renders nothing while no update is waiting', () => {
    const { container } = render(<UpdateToast />)
    expect(container).toBeEmptyDOMElement()
  })

  it('reloads into the new worker only when the user asks', async () => {
    needRefresh = true
    render(<UpdateToast />)

    expect(screen.getByText('A new version is ready')).toBeInTheDocument()
    expect(updateServiceWorker).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('can be dismissed without updating', async () => {
    needRefresh = true
    render(<UpdateToast />)

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }))
    expect(setNeedRefresh).toHaveBeenCalledWith(false)
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })
})
