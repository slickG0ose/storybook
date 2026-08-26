import { Routes, Route, Link } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import BookDetail from './pages/BookDetail'
import CreateBook from './pages/CreateBook'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import OrderConfirmation from './pages/OrderConfirmation'
import Login from './pages/Login'
import Register from './pages/Register'
import MyBooks from './pages/MyBooks'
import Admin from './pages/Admin'
import NotFound from './pages/NotFound'

/** `py-2 -my-2` clears the 24px WCAG tap-target floor without adding footer height. */
const FOOTER_LINK =
  'inline-flex items-center py-2 -my-2 text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 no-underline transition-colors'

function App() {
  return (
    // min-h-dvh, not min-h-screen: 100vh on mobile Safari includes the collapsing
    // toolbar, so a 100vh shell jumps by ~60px the first time the page is scrolled.
    <div className="min-h-dvh bg-cream dark:bg-gray-900 transition-colors flex flex-col">
      {/*
        First tab stop on every page. Without it a keyboard user walks the whole navbar
        — eight controls when signed in as an admin — before reaching the content.
      */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-purple-500 focus:text-white focus:font-semibold focus:no-underline"
      >
        Skip to content
      </a>

      <Navbar />

      <main id="main" className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book/:id" element={<BookDetail />} />
          <Route path="/create" element={<CreateBook />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/:id" element={<OrderConfirmation />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/my-books" element={<MyBooks />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="border-t border-gray-200/70 dark:border-gray-800 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-gray-500 dark:text-gray-400 text-sm font-body">
            Made with AI + Imagination
          </span>
          {/*
            A real <nav> here, which means these links join the mobile suite's
            `nav a, nav button` tap-target sweep. `py-2 -my-2` clears the 24px WCAG
            floor via the hit area without adding vertical space to the footer row.
          */}
          <nav aria-label="Footer" className="flex items-center gap-6 text-sm font-semibold">
            {/*
              Deliberately NOT the navbar's labels. Two links to the same route with the
              same accessible name are one entry repeated twice in a screen reader's link
              list, and Playwright's non-exact `getByRole('link', { name })` matches both
              — which is how the footer's "Create a book" broke the PWA offline-shell spec
              that asserts on the navbar's "Create a Book".
            */}
            <Link to="/#browse" className={FOOTER_LINK}>
              All books
            </Link>
            <Link to="/create" className={FOOTER_LINK}>
              Start a story
            </Link>
            <Link to="/my-books" className={FOOTER_LINK}>
              Your library
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

export default App
