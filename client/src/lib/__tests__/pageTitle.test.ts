import { describe, it, expect } from 'vitest'
import { HOME_TITLE, titleForPath, withSiteName } from '../pageTitle'

describe('titleForPath', () => {
  it('keeps the index.html title on the home page', () => {
    expect(titleForPath('/')).toBe(HOME_TITLE)
  })

  it.each([
    ['/login', 'Sign in · StoryBook'],
    ['/register', 'Create account · StoryBook'],
    ['/create', 'Create a book · StoryBook'],
    ['/my-books', 'My books · StoryBook'],
    ['/my-books/', 'My books · StoryBook'],
    ['/admin', 'Admin · StoryBook'],
    ['/privacy', 'Privacy · StoryBook'],
    ['/book/abc', 'Book · StoryBook'],
    ['/order/abc', 'Order confirmed · StoryBook'],
    ['/nope', 'Page not found · StoryBook'],
  ])('%s -> %s', (path, title) => {
    expect(titleForPath(path)).toBe(title)
  })

  it('names the page first so a truncated tab still says which page it is', () => {
    expect(withSiteName('Luna and the Star Garden')).toBe('Luna and the Star Garden · StoryBook')
  })
})
