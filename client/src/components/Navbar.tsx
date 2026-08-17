import { Link } from 'react-router-dom'
import { ShoppingCart, BookOpen, Sparkles, Moon, Sun, User, LogOut, Shield } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'

/**
 * Mobile sizing note: every responsive class here puts the compact treatment in the
 * BASE utility and restores today's desktop layout at `sm:`. Both mobile e2e projects
 * (360x740 and 393x851) sit below Tailwind's 640px `sm` breakpoint, so the desktop
 * suite exercises only the `sm:` branch and is unaffected.
 *
 * The row must fit 336px of content (360px viewport minus `px-3`) in its densest state
 * — logged-in admin, which renders eight controls. That is why labels, the wordmark and
 * the CTA text all collapse below `sm` while the icon hit areas grow via `p-2 sm:p-0`.
 */

/** Icon-link chrome. `p-2` lifts an 18px lucide glyph to a 34px hit area on mobile. */
const NAV_LINK =
  'text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 flex items-center gap-1 no-underline font-semibold p-2 sm:p-0 rounded-full hover:bg-amber-100/60 dark:hover:bg-gray-700/60 sm:hover:bg-transparent sm:dark:hover:bg-transparent transition-colors'

export default function Navbar() {
  const { items } = useCart()
  const { dark, toggle } = useTheme()
  const { user, loading: authLoading, logout } = useAuth()
  const count = items.reduce((sum, i) => sum + i.quantity, 0)
  // Don't show role-conditional UI until auth resolves to avoid flashes.
  const showAdminLink = !authLoading && user?.role === 'admin'

  return (
    <nav className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-amber-100 dark:border-gray-700 sticky top-0 z-50 transition-colors">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 h-16 flex items-center justify-between gap-1 sm:gap-4">
        <Link to="/" className="flex items-center gap-2 no-underline shrink-0">
          <span className="text-3xl leading-none">{"\u{1F4DA}"}</span>
          <span className="hidden sm:inline text-2xl font-bold text-amber-900 dark:text-amber-300 font-display">StoryBook</span>
        </Link>

        <div className="flex items-center gap-0.5 sm:gap-4">
          <Link to="/#browse" className={NAV_LINK}>
            <BookOpen size={18} />
            <span className="hidden sm:inline">Browse</span>
          </Link>
          {user && (
            <Link to="/my-books" className={NAV_LINK}>
              <User size={18} />
              <span className="hidden sm:inline">My Books</span>
            </Link>
          )}
          {showAdminLink && (
            <Link to="/admin" aria-label="Admin" className={NAV_LINK}>
              <Shield size={18} />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
          <Link
            to="/create"
            aria-label="Create a Book"
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-2.5 sm:px-4 sm:py-2 rounded-full flex items-center gap-1.5 no-underline font-semibold hover:shadow-lg transition-shadow text-sm shrink-0"
          >
            <Sparkles size={16} />
            <span className="hidden sm:inline">Create a Book</span>
          </Link>
          <button
            onClick={toggle}
            className="p-2 rounded-full hover:bg-amber-100 dark:hover:bg-gray-700 text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
            aria-label="Toggle dark mode"
          >
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <Link
            to="/cart"
            className="text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 no-underline flex items-center p-2 sm:p-0 rounded-full hover:bg-amber-100/60 dark:hover:bg-gray-700/60 sm:hover:bg-transparent sm:dark:hover:bg-transparent transition-colors"
          >
            {/* The badge anchors to this inner span, not the link, so the mobile-only
                padding cannot push it away from the icon. */}
            <span className="relative flex">
              <ShoppingCart size={22} />
              {count > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {count}
                </span>
              )}
            </span>
          </Link>
          {user ? (
            <button
              onClick={logout}
              className={`${NAV_LINK} cursor-pointer bg-transparent border-none`}
              aria-label="Sign out"
            >
              <LogOut size={18} />
              <span className="hidden sm:inline">{user.name.split(' ')[0]}</span>
            </button>
          ) : (
            <Link to="/login" className={NAV_LINK}>
              <User size={18} />
              <span className="hidden sm:inline">Sign In</span>
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
