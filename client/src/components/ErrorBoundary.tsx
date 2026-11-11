import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, RotateCcw, TriangleAlert } from 'lucide-react'
import { describeReason, recordRecentError } from '../lib/recentErrors'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * When this changes, a tripped boundary clears and tries its children again.
   * App passes the pathname, so navigating away from a broken page recovers
   * without a full reload (#209).
   */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: unknown
  hasError: boolean
}

/**
 * Catches an error thrown while rendering any page. Without it React unmounts the
 * whole tree and the user gets a blank white page with no way back (#209).
 *
 * It wraps only the routed content, not the shell, so the navbar (and its
 * Feedback button) and the footer keep working while a page is broken.
 *
 * Render errors caught here never reach `window`'s `error` event in production
 * builds, so the recentErrors ring buffer would miss them. componentDidCatch
 * records them there itself, which is how they end up attached to a tester's
 * feedback report.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, hasError: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, hasError: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    recordRecentError(`Render error: ${describeReason(error)}`)
    console.error('[ErrorBoundary] page render failed', error, info.componentStack)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, hasError: false })
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return <ErrorFallback />
  }
}

function ErrorFallback() {
  return (
    <div role="alert" className="max-w-xl mx-auto px-4 py-20 sm:py-28 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 mb-6">
        <TriangleAlert size={38} />
      </div>

      <h1 className="text-4xl sm:text-5xl font-bold text-gray-800 dark:text-gray-100 font-display mb-3">
        This page hit a snag
      </h1>
      <p className="text-gray-600 dark:text-gray-300 mb-2">
        Something went wrong while showing it. Reloading usually fixes it.
      </p>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-9">
        If you&rsquo;re signed in, the Feedback button at the top sends us a note, and the error
        details are attached for you.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 bg-purple-500 hover:bg-purple-600 dark:bg-purple-500 dark:hover:bg-purple-400 text-white px-6 py-3 rounded-full font-bold border-none cursor-pointer shadow-accent hover:shadow-none transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.97]"
        >
          <RotateCcw size={18} />
          Reload the page
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 font-semibold px-4 py-3 rounded-full no-underline transition-colors"
        >
          <BookOpen size={18} />
          Back to the bookshop
        </Link>
      </div>
    </div>
  )
}
