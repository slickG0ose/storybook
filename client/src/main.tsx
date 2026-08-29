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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        {/* Inside ThemeProvider (the host's dark: classes need the theme class on <html>)
            and outside AuthProvider, so any provider or page below can raise a failure
            toast. It only needs the router, for the route-change clear. It renders its
            own ErrorToastHost — there is no separate host to mount. */}
        <ToastProvider>
          <AuthProvider>
            <CartProvider>
              <App />
              {/* Sibling of <App /> rather than inside it: the toast is fixed-position
                  chrome that must survive every route change, and it needs the provider
                  chain (theme classes) without owning a slot in the router tree. */}
              <UpdateToast />
            </CartProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
