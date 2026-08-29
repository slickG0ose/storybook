import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import ErrorToastHost from '../components/ErrorToastHost'

/**
 * The app's single visible failure surface (spec: `.code-captain/specs/error-toast-host/`,
 * issues #115 and #114). Any component that would previously have called `window.alert()`
 * — or written a failure into a local `useState` that renders hundreds of pixels away from
 * the button that caused it — calls `showError(message)` instead.
 *
 * State lives in a React context rather than a module singleton because every call site is
 * an event handler inside a component, and the codebase already shares cross-cutting state
 * through exactly one idiom (ThemeContext / AuthContext / CartContext). A module store
 * would also carry queue state between tests in the same file unless explicitly reset.
 *
 * NO TIMERS LIVE IN THIS FILE, AND NONE MAY BE ADDED. A toast raised here is assertive
 * (`role="alert"` implies `aria-live="assertive"`), and an assertive announcement that
 * expires on its own is unusable: a screen-reader user gets a truncated interruption with
 * no way to re-read it, and WCAG 2.2.1 (Timing Adjustable) is squarely about content that
 * disappears without the user asking. Self-cleaning is handled deterministically instead —
 * by the dedupe, by MAX_TOASTS, and by the route-change clear below.
 */

export interface Toast {
  id: string;
  message: string;
}

export interface ToastContextValue {
  toasts: Toast[];
  /** Raise an assertive failure notice. No-ops if an identical message is already showing. */
  showError: (message: string) => void;
  dismiss: (id: string) => void;
}

/** Newest-first stack depth. A fourth toast drops the oldest rather than walking off-screen. */
export const MAX_TOASTS = 3

/**
 * The only module-level state in this file, and it is write-only: ids come from a counter
 * rather than `crypto.randomUUID()` so they are deterministic under Vitest and independent
 * of a global jsdom does not guarantee. It is never read as state, so it cannot leak
 * behaviour between tests.
 */
let seq = 0

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const { pathname } = useLocation()

  const showError = useCallback((message: string) => {
    setToasts(prev => {
      // Dedupe by exact text: three identical "Couldn't update featured state…" failures
      // are one fact. Returning the same array identity skips the re-render entirely.
      if (prev.some(t => t.message === message)) return prev
      // Newest first, so the newest message sits nearest the top anchor; truncate to the
      // cap, dropping the oldest.
      return [{ id: `toast-${++seq}`, message }, ...prev].slice(0, MAX_TOASTS)
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Toasts persist until dismissed, but not across routes: "Couldn't restore that user."
  // is meaningless on /cart. This is what keeps persistence from becoming permanence
  // without reaching for a timer (spec ruling 3).
  useEffect(() => {
    setToasts([])
  }, [pathname])

  return (
    <ToastContext.Provider value={{ toasts, showError, dismiss }}>
      {children}
      {/* The provider renders its own host. Exposing the host for separate mounting would
          make "provider mounted, host forgotten" a silent failure mode: showError would
          succeed and nothing would appear. */}
      <ErrorToastHost />
    </ToastContext.Provider>
  )
}

/** Throws outside the provider, like useTheme/useAuth/useCart. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
