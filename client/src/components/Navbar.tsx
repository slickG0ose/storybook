import { Link } from 'react-router-dom'
import { ShoppingCart, BookOpen, Sparkles, Moon, Sun, User, LogOut, Shield } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { items } = useCart()
  const { dark, toggle } = useTheme()
  const { user, loading: authLoading, logout } = useAuth()
  const count = items.reduce((sum, i) => sum + i.quantity, 0)
  // Don't show role-conditional UI until auth resolves to avoid flashes.
  const showAdminLink = !authLoading && user?.role === 'admin'

  return (
    <nav className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-amber-100 dark:border-gray-700 sticky top-0 z-50 transition-colors">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <span className="text-3xl">{"\u{1F4DA}"}</span>
          <span className="text-2xl font-bold text-amber-900 dark:text-amber-300 font-display">StoryBook</span>
        </Link>

        <div className="flex items-center gap-4">
          <Link to="/#browse" className="text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 flex items-center gap-1 no-underline font-semibold">
            <BookOpen size={18} />
            <span className="hidden sm:inline">Browse</span>
          </Link>
          {user && (
            <Link to="/my-books" className="text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 flex items-center gap-1 no-underline font-semibold">
              <User size={18} />
              <span className="hidden sm:inline">My Books</span>
            </Link>
          )}
          {showAdminLink && (
            <Link
              to="/admin"
              aria-label="Admin"
              className="text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 flex items-center gap-1 no-underline font-semibold"
            >
              <Shield size={18} />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
          <Link to="/create" className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-full flex items-center gap-1.5 no-underline font-semibold hover:shadow-lg transition-shadow text-sm">
            <Sparkles size={16} />
            Create a Book
          </Link>
          <button
            onClick={toggle}
            className="p-2 rounded-full hover:bg-amber-100 dark:hover:bg-gray-700 text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
            aria-label="Toggle dark mode"
          >
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <Link to="/cart" className="relative text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 no-underline">
            <ShoppingCart size={22} />
            {count > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                {count}
              </span>
            )}
          </Link>
          {user ? (
            <button
              onClick={logout}
              className="flex items-center gap-1 text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 font-semibold cursor-pointer bg-transparent border-none p-0"
              aria-label="Sign out"
            >
              <LogOut size={18} />
              <span className="hidden sm:inline">{user.name.split(' ')[0]}</span>
            </button>
          ) : (
            <Link to="/login" className="text-amber-800 dark:text-amber-300 hover:text-amber-600 dark:hover:text-amber-200 flex items-center gap-1 no-underline font-semibold">
              <User size={18} />
              <span className="hidden sm:inline">Sign In</span>
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
