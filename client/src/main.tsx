import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import UpdateToast from './components/UpdateToast'
import ErrorBoundary from './components/ErrorBoundary'
import { installRecentErrorCapture } from './lib/recentErrors'

// Before render, so an error thrown while the app boots is still captured. Feeds
// recent_errors on tester feedback reports (FeedbackDialog).
installRecentErrorCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        {/* Outside the root ErrorBoundary below, on purpose. On 2026-11-11 a crash in
            Navbar (above App's per-page boundary) unmounted the whole tree, this toast
            with it, so the fixed build waiting in the service worker could never be
            offered and every reload landed on the same blank page. Here it survives any
            throw from the providers or App. It needs only ThemeProvider (for the dark
            class on <html>), not auth, cart or the router. */}
        <UpdateToast />
        {/* Root boundary: catches what App's per-page boundary cannot — the navbar, the
            footer, and the providers themselves. Its fallback reload also applies a
            waiting worker (see reloadIntoLatestBuild), so a broken build can always be
            replaced by a newer one. Inside BrowserRouter because the fallback links home. */}
        <ErrorBoundary fullPage>
          {/* Inside ThemeProvider (the host's dark: classes need the theme class on <html>)
              and outside AuthProvider, so any provider or page below can raise a failure
              toast. It only needs the router, for the route-change clear. It renders its
              own ErrorToastHost — there is no separate host to mount. */}
          <ToastProvider>
            <AuthProvider>
              <CartProvider>
                <App />
              </CartProvider>
            </AuthProvider>
          </ToastProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
