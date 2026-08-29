import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { MAX_TOASTS, ToastProvider, useToast } from '../ToastContext'

/**
 * Queue semantics only. Rendering, a11y, and dark parity live in
 * `client/src/components/__tests__/ErrorToastHost.test.tsx`.
 *
 * The probe renders the queue as plain text nodes under its own testid so these
 * assertions never collide with the host the provider also renders.
 */
function Probe() {
  const { toasts, showError, dismiss } = useToast()
  const navigate = useNavigate()
  return (
    <div>
      <button onClick={() => showError('first failure')}>Raise first</button>
      <button onClick={() => showError('second failure')}>Raise second</button>
      <button onClick={() => showError('third failure')}>Raise third</button>
      <button onClick={() => showError('fourth failure')}>Raise fourth</button>
      <button onClick={() => toasts[0] && dismiss(toasts[0].id)}>Dismiss newest</button>
      <button onClick={() => navigate('/elsewhere')}>Go elsewhere</button>
      <ol data-testid="queue">
        {toasts.map(t => (
          <li key={t.id} data-testid="queue-entry">{t.message}</li>
        ))}
      </ol>
    </div>
  )
}

function renderProbe() {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <ToastProvider>
        <Routes>
          <Route path="/start" element={<Probe />} />
          <Route path="/elsewhere" element={<Probe />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const queue = () => screen.getAllByTestId('queue-entry').map(li => li.textContent)

describe('ToastContext', () => {
  it('holds a raised message in the queue', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'Raise first' }))
    expect(queue()).toEqual(['first failure'])
  })

  it('dedupes by exact message — the same failure twice is one entry', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'Raise first' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise first' }))
    expect(queue()).toEqual(['first failure'])
  })

  it('stacks distinct messages newest first', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'Raise first' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise second' }))
    expect(queue()).toEqual(['second failure', 'first failure'])
  })

  it(`caps the stack at ${MAX_TOASTS}, dropping the oldest`, () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'Raise first' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise second' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise third' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise fourth' }))
    expect(queue()).toHaveLength(MAX_TOASTS)
    expect(queue()).toEqual(['fourth failure', 'third failure', 'second failure'])
  })

  it('dismisses exactly the entry it is given', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'Raise first' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise second' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss newest' }))
    expect(queue()).toEqual(['first failure'])
  })

  it('empties the queue on a route change', () => {
    renderProbe()
    fireEvent.click(screen.getByRole('button', { name: 'Raise first' }))
    expect(queue()).toEqual(['first failure'])
    fireEvent.click(screen.getByRole('button', { name: 'Go elsewhere' }))
    expect(screen.queryAllByTestId('queue-entry')).toHaveLength(0)
  })

  it('throws when useToast is called outside a ToastProvider', () => {
    // React logs the thrown render error; silence it so the suite output stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <MemoryRouter>
          <Probe />
        </MemoryRouter>,
      ),
    ).toThrow(/useToast must be used within a ToastProvider/)
    spy.mockRestore()
  })
})
