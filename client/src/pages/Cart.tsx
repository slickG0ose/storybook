import { Link } from 'react-router-dom'
import { Trash2, Plus, Minus, ShoppingBag, WifiOff } from 'lucide-react'
import { useCart } from '../context/CartContext'

/**
 * "a moment ago" / "12 minutes ago" / "3 hours ago" / "2 days ago".
 *
 * Deliberately coarse: the banner's job is to tell the user how much to trust what they
 * are looking at, not to be a clock. Returns null for a missing or unparseable stamp so
 * the caller can drop the "from ..." clause entirely rather than print "from Invalid Date".
 */
function formatRelative(iso: string | null, now: number = Date.now()): string | null {
  if (iso === null) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'a moment ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Offline is read-only by design (spec §Alternatives → "Offline cart strategy"): the
 * cart shown here came from the localStorage snapshot, and every mutation control is
 * disabled rather than allowed to fail silently. Saying so is the whole point — a
 * disabled "+" with no explanation reads as a bug.
 */
function OfflineBanner({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const relative = formatRelative(lastSyncedAt)
  const headline =
    relative === null
      ? "You're offline. Showing your last saved cart."
      : `You're offline. Showing your saved cart from ${relative}.`

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/30 p-4 transition-colors"
    >
      <WifiOff size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
      <div className="min-w-0">
        <p className="font-semibold text-amber-900 dark:text-amber-200">{headline}</p>
        <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300/90">
          Quantity changes, removals and checkout are unavailable until you reconnect.
        </p>
      </div>
    </div>
  )
}

export default function Cart() {
  const { items, total, updateQuantity, removeFromCart, offline, lastSyncedAt } = useCart()

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        {offline && (
          <div className="text-left">
            <OfflineBanner lastSyncedAt={lastSyncedAt} />
          </div>
        )}
        <ShoppingBag size={64} className="text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">Your cart is empty</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">Time to find some magical stories!</p>
        <Link
          to="/"
          className="inline-block bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-xl font-bold no-underline transition-colors"
        >
          Browse Books
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display mb-6">Your Cart</h1>

      {offline && <OfflineBanner lastSyncedAt={lastSyncedAt} />}

      <div className="space-y-4">
        {items.map(item => (
          /* Below `sm` the row wraps: thumb + title on line one, the controls group on
             line two. Un-wrapped, the 64px thumb, title, 3 quantity controls, w-20 price
             and delete button share ~328px and every flex child shrinks instead of
             overflowing — which is why the horizontal-overflow assertion cannot see it. */
          <div key={item.book_id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 transition-colors">
            <div
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center text-2xl sm:text-3xl shrink-0"
              style={{ backgroundColor: (item.cover_color || '#6366f1') + '20' }}
            >
              {item.cover_emoji}
            </div>
            <div className="flex-1 min-w-0">
              <Link to={`/book/${item.book_id}`} className="font-bold text-gray-800 dark:text-gray-100 hover:text-purple-600 dark:hover:text-purple-400 no-underline">
                {item.title}
              </Link>
              <div className="text-gray-500 dark:text-gray-400 text-sm">${item.price?.toFixed(2)} each</div>
            </div>
            {/* `w-full` forces the wrap below `sm`; `sm:w-auto` + `sm:gap-4` restores the
                original single-row spacing above it, so the desktop suite is untouched. */}
            <div className="flex w-full sm:w-auto shrink-0 items-center justify-between sm:justify-end gap-2 sm:gap-4">
              <div className="flex items-center gap-2">
                <button
                  aria-label="Decrease quantity"
                  disabled={offline}
                  onClick={() => void updateQuantity(item.book_id, item.quantity - 1)}
                  className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:hover:bg-gray-100 dark:disabled:hover:bg-gray-700 flex items-center justify-center cursor-pointer transition-colors text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Minus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                </button>
                <span data-testid="cart-quantity" className="w-8 text-center font-bold text-gray-800 dark:text-gray-100">{item.quantity}</span>
                <button
                  aria-label="Increase quantity"
                  disabled={offline}
                  onClick={() => void updateQuantity(item.book_id, item.quantity + 1)}
                  className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:hover:bg-gray-100 dark:disabled:hover:bg-gray-700 flex items-center justify-center cursor-pointer transition-colors text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="text-right w-20">
                  <div className="font-bold text-gray-800 dark:text-gray-100">${(item.price * item.quantity).toFixed(2)}</div>
                </div>
                <button
                  aria-label="Remove from cart"
                  disabled={offline}
                  onClick={() => void removeFromCart(item.book_id)}
                  className="w-11 h-11 sm:w-auto sm:h-auto flex items-center justify-center shrink-0 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 disabled:hover:text-gray-400 dark:disabled:hover:text-gray-500 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 mt-6 transition-colors">
        <div className="flex justify-between items-center mb-4">
          <span className="text-lg font-semibold text-gray-600 dark:text-gray-300">Total</span>
          <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">${total.toFixed(2)}</span>
        </div>
        {/* A react-router <Link> renders an <a>, which has no `disabled` attribute and no
            disabled semantics — suppressing pointer events on one would still leave it
            keyboard-navigable. Offline swaps in a genuinely disabled <button> instead, so
            "cannot check out" is true for the keyboard and the accessibility tree, not just
            the mouse. Online, the link is byte-for-byte the one the desktop suite clicks. */}
        {offline ? (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="block w-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 py-3 rounded-xl font-bold text-center cursor-not-allowed transition-colors"
          >
            Proceed to Checkout
          </button>
        ) : (
          <Link
            to="/checkout"
            className="block w-full bg-purple-500 hover:bg-purple-600 dark:bg-purple-500 dark:hover:bg-purple-400 text-white py-3 rounded-xl font-bold text-center no-underline transition-colors"
          >
            Proceed to Checkout
          </Link>
        )}
      </div>
    </div>
  )
}
