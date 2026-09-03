import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Login from '../Login'
import Register from '../Register'

/**
 * iOS capitalises the first letter of a bare `type="email"` input, so a tester on a
 * phone registers as `Nick@gmail.com` and then cannot log in. The server normalises
 * the value now, but that only makes the stored value right — these attributes stop
 * the wrong value being typed and echoed back in the field. Attributes only: no
 * className changed on either page, which is why dark-mode parity is N/A here.
 */
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}))

const pages = [
  ['Login', <Login key="login" />],
  ['Register', <Register key="register" />],
] as const

describe.each(pages)('%s email field', (_name, element) => {
  it('opts out of mobile autocapitalisation and autocorrect', () => {
    // Neither page wires label->input with htmlFor, so query the field by type.
    const { container } = render(<MemoryRouter>{element}</MemoryRouter>)

    const email = container.querySelector('input[type="email"]')
    expect(email).not.toBeNull()
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(email).toHaveAttribute('autocorrect', 'off')
    expect(email).toHaveAttribute('spellcheck', 'false')
  })
})
