import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import Login from '../Login'

const login = vi.fn().mockResolvedValue(null)
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, login, register: vi.fn(), logout: vi.fn() }),
}))

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function mount(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function submit(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: 'a@b.c' } })
  fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
}

describe('Login session-end notice and return path', () => {
  it('shows the notice only with reason expired', () => {
    const a = mount({ reason: 'expired', from: '/my-books' })
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in to pick up where you left off.')
    a.unmount()
    mount()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('returns to state.from after sign-in', async () => {
    const { container } = mount({ reason: 'expired', from: '/create?step=2' })
    await submit(container)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/create?step=2'))
  })

  it.each([
    ['a protocol-relative from', { from: '//evil.example' }],
    ['a missing from', undefined],
  ])('falls back to /my-books for %s', async (_n, state) => {
    const { container } = mount(state)
    await submit(container)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/my-books'))
  })
})
