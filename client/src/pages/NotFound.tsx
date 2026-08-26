import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Compass, ArrowLeft, BookOpen } from 'lucide-react'

/**
 * Catch-all route. Before this existed, any unmatched path rendered the chrome around
 * an empty <main> — a blank cream page with no explanation and no way onward.
 */
export default function NotFound() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <div className="max-w-xl mx-auto px-4 py-20 sm:py-28 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 mb-6">
        <Compass size={38} />
      </div>

      <h1 className="text-4xl sm:text-5xl font-bold text-gray-800 dark:text-gray-100 font-display mb-3">
        This page wandered off
      </h1>
      <p className="text-gray-600 dark:text-gray-300 mb-2">
        Nothing lives at <code className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{pathname}</code> — it
        may have been renamed, or the link that brought you here was wrong.
      </p>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-9">
        The books are all still where you left them.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-full font-bold no-underline shadow-accent hover:shadow-none transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.97]"
        >
          <BookOpen size={18} />
          Browse the collection
        </Link>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 font-semibold px-4 py-3 rounded-full cursor-pointer bg-transparent border-none transition-colors"
        >
          <ArrowLeft size={18} />
          Go back
        </button>
      </div>
    </div>
  )
}
