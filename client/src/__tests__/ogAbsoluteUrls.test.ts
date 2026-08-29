import { describe, it, expect } from 'vitest'
import { absolutiseOgUrls, normalisePublicOrigin, InvalidPublicOriginError } from '../../og.config'

/**
 * Pins the og:image absolutisation (#120) without paying for a `vite build`. The failure
 * this guards is invisible locally and in CI: a wrong URL here still renders a perfect
 * page, and only a scraper reports the miss — months later, on a deploy nobody is
 * watching.
 */
describe('normalisePublicOrigin', () => {
  it('keeps a bare https origin', () => {
    expect(normalisePublicOrigin('https://storybook.example')).toBe('https://storybook.example')
  })

  it('strips a trailing slash, so the join never doubles it', () => {
    expect(normalisePublicOrigin('https://storybook.example/')).toBe('https://storybook.example')
  })

  it('keeps a non-default port', () => {
    expect(normalisePublicOrigin('http://localhost:4173')).toBe('http://localhost:4173')
  })

  it.each([
    ['storybook.example', 'no scheme'],
    ['//storybook.example', 'protocol-relative'],
    ['ftp://storybook.example', 'wrong protocol'],
    ['', 'empty'],
  ])('rejects %j (%s)', (raw) => {
    expect(() => normalisePublicOrigin(raw)).toThrow(InvalidPublicOriginError)
  })

  it('rejects an origin carrying a path, rather than silently dropping it', () => {
    // This is the realistic typo: pasting the Pages URL including its /storybook/ prefix.
    // Prepending it would double the base, so it must fail loudly at build time.
    expect(() => normalisePublicOrigin('https://slickg0ose.github.io/storybook/')).toThrow(
      InvalidPublicOriginError,
    )
  })
})

describe('absolutiseOgUrls', () => {
  const origin = 'https://storybook.example'

  it('makes a root-relative og:image absolute', () => {
    const html = '<meta property="og:image" content="/icons/og-image.jpg" />'
    expect(absolutiseOgUrls(html, origin)).toBe(
      '<meta property="og:image" content="https://storybook.example/icons/og-image.jpg" />',
    )
  })

  it('preserves a base path Vite has already applied', () => {
    // The plugin runs at order:'post', so the path it sees is already base-prefixed.
    // Only the origin may be prepended — joining the base again yields /storybook/storybook/.
    const html = '<meta property="og:image" content="/storybook/icons/og-image.jpg" />'
    expect(absolutiseOgUrls(html, origin)).toContain(
      'content="https://storybook.example/storybook/icons/og-image.jpg"',
    )
    expect(absolutiseOgUrls(html, origin)).not.toContain('/storybook/storybook/')
  })

  it('leaves an already-absolute URL alone', () => {
    const html = '<meta property="og:image" content="https://cdn.example/og.jpg" />'
    expect(absolutiseOgUrls(html, origin)).toBe(html)
  })

  it('does not touch og:title, og:description, or og:type', () => {
    const html =
      '<meta property="og:type" content="website" />' +
      '<meta property="og:title" content="StoryBook" />' +
      '<meta property="og:description" content="/not/a/path but starts mid-sentence" />'
    expect(absolutiseOgUrls(html, origin)).toBe(html)
  })

  it('rewrites twitter:image too — it is a name= attribute, not property=', () => {
    const html = '<meta name="twitter:image" content="/icons/og-image.jpg" />'
    expect(absolutiseOgUrls(html, origin)).toContain('content="https://storybook.example/icons/og-image.jpg"')
  })
})
