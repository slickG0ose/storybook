import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HeroArt from '../HeroArt'

// Component-level mirror of the `Home hero art` block in
// `client/src/pages/__tests__/Home.test.tsx`. That block stays as the integration pin —
// it proves the hero survives being rendered inside the real page — and this one gives
// future hero work a local test to run without booting all of `Home`.
//
// HeroArt takes no props and consumes no context, so there is nothing to wrap it in.
describe('HeroArt', () => {
  // Same selector shape the e2e spec uses: the accessible name comes from `alt`.
  function heroImg() {
    return screen.getByRole('img', { name: /bench/i })
  }

  it('renders the hero illustration with an accessible name', () => {
    render(<HeroArt />)
    expect(heroImg()).toBeInTheDocument()
  })

  it('describes the artwork rather than the product in its alt text', () => {
    render(<HeroArt />)
    const alt = heroImg().getAttribute('alt') ?? ''

    // Mechanical form of the spec's "alt describes the art, not the product" constraint.
    // Word boundaries matter: "backpack" is part of the description and must not trip
    // the `book` case.
    expect(alt).not.toMatch(/\b(AI|book|storybook|create)\b/i)
    expect(alt).toMatch(/bench/i)
  })

  it('reserves its box with intrinsic dimensions', () => {
    render(<HeroArt />)
    const art = heroImg()

    // Paired with `aspect-square` in the class list, these stop the image landing from
    // shifting the fold on a slow connection.
    expect(art).toHaveAttribute('width', '960')
    expect(art).toHaveAttribute('height', '960')
    expect(art.className).toContain('aspect-square')
  })

  it('is eagerly loaded and high priority', () => {
    render(<HeroArt />)
    const art = heroImg()

    // Above the fold: lazy-loading would defer the LCP candidate.
    expect(art.getAttribute('loading')).not.toBe('lazy')
    // React 19 lowercases `fetchPriority` on the way into the DOM.
    expect(art.getAttribute('fetchpriority')).toBe('high')
  })

  it('offers two responsive candidates with a sizes hint', () => {
    render(<HeroArt />)
    const art = heroImg()

    const srcset = art.getAttribute('srcset') ?? ''
    expect(srcset.split(',')).toHaveLength(2)

    // Pinned as shipped. The desktop value deliberately overstates the 420 CSS px the
    // image actually lays out at on a 1440 viewport — it only biases toward the larger
    // candidate, which a 2x display picks anyway. Retune this line if the grid changes.
    expect(art).toHaveAttribute('sizes', '(min-width: 1024px) 440px, 300px')
  })

  it('stacks the image inside a positioned, height-reserved box', () => {
    render(<HeroArt />)

    // The layer that rotation will stack into. Asserted here so the extraction, not the
    // rotation commit, is what owns the layout — a later `absolute inset-0` sibling needs
    // this ancestor to be `relative` and to already reserve its height.
    const layers = heroImg().parentElement
    expect(layers).not.toBeNull()
    expect(layers!.className).toContain('relative')
    expect(layers!.className).toContain('aspect-square')
  })
})
