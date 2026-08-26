import { useState, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Sparkles, Search, X, BookOpen, Eye } from 'lucide-react'
import BookCard from '../components/BookCard'
import { api } from '../lib/apiBase'
import type { Book, Page } from '../types'

function BookPreviewModal({ book, onClose }: { book: Book; onClose: () => void }) {
  const [firstPage, setFirstPage] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(api(`/api/books/${book.id}`))
      .then(r => r.json())
      .then(data => {
        if (data.pages?.length) setFirstPage(data.pages[0])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [book.id])

  return (
    <div className="fixed inset-0 bg-gray-950/55 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl"
                style={{ backgroundColor: book.cover_color + '20' }}
              >
                {book.cover_emoji}
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 font-display">{book.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">by {book.author}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer">
              <X size={20} />
            </button>
          </div>

          <p className="text-gray-600 dark:text-gray-300 mb-4">{book.description}</p>

          <div className="flex gap-2 mb-4">
            <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">
              Ages {book.age_range}
            </span>
            <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full font-semibold capitalize">
              {book.theme}
            </span>
          </div>

          {loading ? (
            <div className="py-8 text-center text-gray-400">Loading preview...</div>
          ) : firstPage ? (
            <div className="bg-amber-50 dark:bg-gray-700/50 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">
                <BookOpen size={14} />
                First Page Preview
              </div>
              <p className="text-gray-700 dark:text-gray-200 italic leading-relaxed">{firstPage.text}</p>
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-2">
            <span className="text-2xl font-bold text-gray-800 dark:text-gray-100 tnum">${book.price.toFixed(2)}</span>
            <Link
              to={`/book/${book.id}`}
              className="inline-flex items-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-5 py-2.5 rounded-xl font-semibold no-underline transition-[background-color,transform] duration-150 active:scale-[0.97]"
            >
              <Eye size={16} />
              View Full Book
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A BookCard plus its quick-preview affordance. The three grids on this page all
 * rendered the same wrapper markup inline; it is one component now so the hover and
 * focus behaviour cannot drift between them.
 *
 * On a pointing device the button stays hidden until the card is hovered or something
 * inside it takes keyboard focus, so the catalog is not peppered with floating circles.
 * The hiding is gated behind `can-hover` (`@media (hover: hover)`): touch devices never
 * receive hover, and an `opacity-0` element is still tappable, so without that gate this
 * was an invisible control sitting over every card's top-right corner.
 */
function PreviewableCard({
  book,
  onPreview,
  variant,
}: {
  book: Book;
  onPreview: (b: Book) => void;
  variant?: 'default' | 'wide';
}) {
  return (
    <div className="relative group/preview h-full">
      <BookCard book={book} variant={variant} />
      <button
        onClick={() => onPreview(book)}
        aria-label={`Quick preview of ${book.title}`}
        className="absolute top-3 right-3 bg-white/95 dark:bg-gray-800/95 text-purple-600 dark:text-purple-300 p-2 rounded-xl shadow-card cursor-pointer
                   can-hover:opacity-0 can-hover:group-hover/preview:opacity-100
                   can-hover:focus-visible:opacity-100 can-hover:group-focus-within/preview:opacity-100
                   transition-[opacity,transform] duration-200 active:scale-90"
      >
        <Eye size={16} />
      </button>
    </div>
  )
}

/**
 * Loading placeholder shaped like a BookCard rather than a spinner, so the grid does
 * not reflow when the real cards arrive.
 */
function BookCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-[20px] shadow-card overflow-hidden">
      <div className="h-36 sm:h-48 bg-gray-100 dark:bg-gray-700 animate-pulse" />
      <div className="p-4 space-y-3">
        <div className="h-5 w-3/4 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
        <div className="h-3 w-full rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
        <div className="h-11 w-full rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  )
}

export default function Home() {
  const location = useLocation()
  const [books, setBooks] = useState<Book[]>([])
  const [themes, setThemes] = useState<string[]>([])
  const [ageRanges, setAgeRanges] = useState<string[]>([])
  const [activeTheme, setActiveTheme] = useState<string | null>(null)
  const [activeAge, setActiveAge] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [previewBook, setPreviewBook] = useState<Book | null>(null)

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1)
      const target = document.getElementById(id)
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.hash, location.key, loading])

  useEffect(() => {
    Promise.all([
      fetch(api('/api/books')).then(r => r.json()) as Promise<Book[]>,
      fetch(api('/api/books/themes')).then(r => r.json()) as Promise<string[]>,
      fetch(api('/api/books/age-ranges')).then(r => r.json()) as Promise<string[]>,
    ]).then(([booksData, themesData, ageData]) => {
      setBooks(booksData)
      setThemes(themesData)
      setAgeRanges(ageData)
      setLoading(false)
    })
  }, [])

  const featured = useMemo(() => books.filter(b => b.is_featured && !b.is_user_created), [books])
  const community = useMemo(() => books.filter(b => b.is_user_created), [books])

  const catalog = useMemo(() => {
    let result = books
    if (activeTheme) result = result.filter(b => b.theme === activeTheme)
    if (activeAge) result = result.filter(b => b.age_range === activeAge)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q)
      )
    }
    return result
  }, [books, activeTheme, activeAge, searchQuery])

  const hasActiveFilters = activeTheme || activeAge || searchQuery.trim()

  return (
    <div>
      {/*
        Hero. The old treatment was an even top-to-bottom purple->amber linear fade,
        which is both the flattest possible gradient and the palette that reads as
        stock-AI. This is the cream surface with two off-centre radial glows instead:
        the light has a direction, and nothing is evenly interpolated.
      */}
      <section
        className="relative bg-cream dark:bg-gray-900 py-20 sm:py-24 px-4 text-center transition-colors
                   bg-[radial-gradient(70%_85%_at_88%_-15%,var(--color-purple-100),transparent_62%),radial-gradient(42%_55%_at_-8%_52%,var(--color-amber-100),transparent_66%)]
                   dark:bg-[radial-gradient(70%_85%_at_88%_-15%,var(--color-purple-950),transparent_62%),radial-gradient(42%_55%_at_-8%_52%,#2a2013,transparent_66%)]"
      >
        <div className="relative">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-800 dark:text-gray-100 mb-5 font-display max-w-4xl mx-auto">
            Stories Made with <span className="text-purple-500 dark:text-purple-300">Magic</span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 max-w-[52ch] mx-auto mb-9">
            Beautiful children's books crafted by AI. Browse our collection or create a one-of-a-kind story for your little one.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/create"
              className="inline-flex items-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-8 py-3.5 rounded-full font-bold text-lg no-underline shadow-accent hover:shadow-none transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.97]"
            >
              <Sparkles size={20} />
              Create Your Own Book
            </Link>
          </div>

          {/* Search Bar */}
          <div className="max-w-xl mx-auto mt-8">
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search books by title, description, or author..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-10 py-3 rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Featured Catalog (only when not searching) */}
        {!hasActiveFilters && featured.length > 0 && (
          <section className="mb-16">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-6 font-display">Featured stories</h2>
            {/*
              The lead title gets a full-width horizontal card and the rest sit in a
              two-up grid below it. Three equal columns is the layout every generated
              storefront ships with, and it also flattened the hierarchy: nothing in a
              "featured" row was actually more featured than anything else.
            */}
            <div className="mb-6">
              {/* slice(0, 1) rather than featured[0]: indexed access is not narrowed by
                  the length check above under noUncheckedIndexedAccess. */}
              {featured.slice(0, 1).map(book => (
                <PreviewableCard key={book.id} book={book} onPreview={setPreviewBook} variant="wide" />
              ))}
            </div>
            {featured.length > 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {featured.slice(1).map(book => (
                  <PreviewableCard key={book.id} book={book} onPreview={setPreviewBook} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Community Creations (only when not searching) */}
        {!hasActiveFilters && community.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display">Community creations</h2>
              <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full font-semibold">
                Reader-made
              </span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
              Stories created by our community using the AI story creator.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {community.map(book => (
                <PreviewableCard key={book.id} book={book} onPreview={setPreviewBook} />
              ))}
            </div>
          </section>
        )}

        {/* Browse All with Filters */}
        <section id="browse" style={{ scrollMarginTop: '5rem' }}>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display mr-4">
              {hasActiveFilters ? 'Search results' : 'All books'}
            </h2>
            {hasActiveFilters && (
              <button
                onClick={() => { setActiveTheme(null); setActiveAge(null); setSearchQuery('') }}
                className="text-xs text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Filter row */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            {/* Theme filters */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Theme</span>
              <button
                onClick={() => setActiveTheme(null)}
                className={`px-3 py-1 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                  !activeTheme ? 'bg-purple-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                All
              </button>
              {themes.map(theme => (
                <button
                  key={theme}
                  onClick={() => setActiveTheme(activeTheme === theme ? null : theme)}
                  className={`px-3 py-1 rounded-full text-sm font-semibold capitalize transition-colors cursor-pointer ${
                    activeTheme === theme ? 'bg-purple-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>

            {/* Age range filters */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Ages</span>
              <button
                onClick={() => setActiveAge(null)}
                className={`px-3 py-1 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                  !activeAge ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                All
              </button>
              {ageRanges.map(range => (
                <button
                  key={range}
                  onClick={() => setActiveAge(activeAge === range ? null : range)}
                  className={`px-3 py-1 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                    activeAge === range ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6" aria-busy="true" aria-label="Loading books">
              {Array.from({ length: 6 }, (_, i) => <BookCardSkeleton key={i} />)}
            </div>
          ) : catalog.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {catalog.map(book => (
                <PreviewableCard key={book.id} book={book} onPreview={setPreviewBook} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <Search size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-gray-500 dark:text-gray-400 text-lg">No books found matching your filters.</p>
              <button
                onClick={() => { setActiveTheme(null); setActiveAge(null); setSearchQuery('') }}
                className="mt-3 text-purple-500 hover:underline cursor-pointer font-semibold"
              >
                Clear all filters
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Preview Modal */}
      {previewBook && <BookPreviewModal book={previewBook} onClose={() => setPreviewBook(null)} />}
    </div>
  )
}
