import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider, useToast } from '../../context/ToastContext'

/**
 * The host is never mounted directly — `ToastProvider` renders it (mounting the provider
 * without the host would be a silent failure mode). Tests drive it through a probe that
 * raises real toasts, which is also how every page test asserts on toast text.
 */
function Probe() {
  const { showError } = useToast()
  return (
    <div>
      <button onClick={() => showError('Could not reach the server.')}>Fail once</button>
      <button onClick={() => showError('Second failure.')}>Fail twice</button>
      <button onClick={() => showError('Third failure.')}>Fail thrice</button>
    </div>
  )
}

function renderHost() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Probe />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const host = () => screen.getByTestId('error-toast-host')

describe('ErrorToastHost', () => {
  it('renders nothing while the queue is empty', () => {
    renderHost()
    expect(screen.queryByTestId('error-toast-host')).toBeNull()
  })

  it('renders a raised message inside the host as an assertive alert', async () => {
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Fail once' }))

    const card = within(host()).getByRole('alert')
    expect(card).toHaveTextContent('Could not reach the server.')
  })

  it('leaves aria-live off the wrapper — role="alert" children already announce', async () => {
    // A live region wrapping live children double-announces in several screen readers.
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Fail once' }))

    expect(host()).not.toHaveAttribute('aria-live')
    expect(host()).not.toHaveAttribute('role')
  })

  it('dismisses the card it belongs to', async () => {
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Fail once' }))

    await userEvent.click(within(host()).getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByTestId('error-toast-host')).toBeNull()
  })

  it('stacks three failures newest first', async () => {
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Fail once' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fail twice' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fail thrice' }))

    const cards = within(host()).getAllByTestId('error-toast')
    expect(cards).toHaveLength(3)
    expect(cards.map(c => c.textContent)).toEqual([
      expect.stringContaining('Third failure.'),
      expect.stringContaining('Second failure.'),
      expect.stringContaining('Could not reach the server.'),
    ])
  })

  it('pairs every colour class on the card with a dark: partner', async () => {
    // Same shape `dark-mode-parity-check` reads: light class and partner in one literal.
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Fail once' }))

    const card = within(host()).getByTestId('error-toast')
    expect(card.className).toContain('bg-white')
    expect(card.className).toContain('dark:bg-gray-800')
    expect(card.className).toContain('border-red-200')
    expect(card.className).toContain('dark:border-red-800')

    expect(within(card).getByText('Could not reach the server.').className).toContain('text-gray-700')
    expect(within(card).getByText('Could not reach the server.').className).toContain('dark:text-gray-200')
  })

  it('is top-anchored, not bottom — UpdateToast stays the only bottom-fixed surface', async () => {
    // ADR-011 decision 5. `e2e/tests/mobile/{narration,edit-published}.spec.ts` assert
    // `position !== 'fixed'` on that basis; anchoring this host at the bottom would put two
    // fixed surfaces in the same 60px of a phone screen.
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Fail once' }))

    expect(host().className).toContain('top-20')
    expect(host().className).not.toContain('bottom-')
  })

  it('gives the dismiss control a 44px tap target and an accessible name', async () => {
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Fail once' }))

    const dismiss = within(host()).getByRole('button', { name: 'Dismiss error' })
    expect(dismiss.className).toContain('min-h-11')
    // Both dimensions: height alone left a 34px-wide target, under the 44px floor the
    // mobile e2e spec asserts with `expectTapTargets`.
    expect(dismiss.className).toContain('min-w-11')
  })
})
