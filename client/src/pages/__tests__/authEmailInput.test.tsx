import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    // Neither page wires label->input with htmlFor (#175), so query by type.
    const { container } = render(<MemoryRouter>{element}</MemoryRouter>)

    const email = container.querySelector('input[type="email"]')
    expect(email).not.toBeNull()
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(email).toHaveAttribute('autocorrect', 'off')
    expect(email).toHaveAttribute('spellcheck', 'false')
  })
})

/**
 * The render tests above only fence the two pages cheap enough to mount. Checkout
 * and Admin carry the same fix but need heavy context mocks to render, and a future
 * page could add a fourth email field with none of this.
 *
 * So the real fence is a source scan: EVERY `type="email"` input in client/src must
 * carry all three attributes. It catches the files the render tests can't reach and
 * any input added later, which is the failure mode that actually worries us — this
 * is a silent regression, not a loud one. Nothing breaks when the attributes go
 * missing; a tester on a phone just quietly cannot log in.
 */
describe('every email input in client/src', () => {
  it('opts out of mobile autocapitalisation and autocorrect', () => {
    const srcDir = join(import.meta.dirname, '../..')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) files.push(full)
      }
    }
    walk(srcDir)

    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      for (const tag of source.match(/<input\b[\s\S]*?\/>/g) ?? []) {
        if (!tag.includes('type="email"')) continue
        const missing = ['autoCapitalize="none"', 'autoCorrect="off"', 'spellCheck={false}'].filter(
          attr => !tag.includes(attr),
        )
        if (missing.length > 0) {
          offenders.push(`${file.replace(srcDir, 'client/src')} — missing ${missing.join(', ')}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('finds the four inputs it is meant to be guarding', () => {
    // Guards the guard: a regex that silently matches nothing would pass the test
    // above forever. If an email input is legitimately added or removed, update this.
    const srcDir = join(import.meta.dirname, '../..')
    let count = 0
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
          const source = readFileSync(full, 'utf-8')
          count += (source.match(/<input\b[\s\S]*?\/>/g) ?? []).filter(t =>
            t.includes('type="email"'),
          ).length
        }
      }
    }
    walk(srcDir)

    expect(count).toBe(4)
  })
})
