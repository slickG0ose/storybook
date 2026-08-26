import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, CreditCard, Loader2 } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { api } from '../lib/apiBase'

export default function Checkout() {
  const { items, total, sessionId } = useCart()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-display mb-4">Nothing to check out</h2>
        <Link to="/" className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 no-underline font-semibold">
          Browse Books
        </Link>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(api('/api/orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, customerName: name, customerEmail: email }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error || 'Order failed')
      }
      const order = await res.json() as { id: string }
      navigate(`/order/${order.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/cart" className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 mb-6 no-underline font-semibold">
        <ArrowLeft size={18} /> Back to Cart
      </Link>

      <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display mb-6">Checkout</h1>

      <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
        {/* Order Summary */}
        <div className="bg-amber-50 dark:bg-gray-800 rounded-2xl p-4 sm:p-6 transition-colors">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 font-display mb-4">Order Summary</h2>
          <div className="space-y-3">
            {items.map(item => (
              <div key={item.book_id} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 text-gray-600 dark:text-gray-400">{item.cover_emoji} {item.title} x{item.quantity}</span>
                <span className="shrink-0 font-semibold text-gray-800 dark:text-gray-200">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <hr className="my-4 border-amber-200 dark:border-gray-700" />
          <div className="flex justify-between font-bold text-lg text-gray-800 dark:text-gray-100">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Payment Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 sm:p-6 transition-colors">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 font-display mb-4">Your Details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:border-purple-400 dark:focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:border-purple-400 dark:focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border-2 border-dashed border-gray-200 dark:border-gray-600">
              <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 text-sm">
                <CreditCard size={16} />
                <span>Payment integration coming soon (demo mode)</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-purple-500 hover:bg-purple-600 dark:bg-purple-500 dark:hover:bg-purple-400 text-white py-3 rounded-xl font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <><Loader2 size={18} className="animate-spin" /> Placing Order...</>
              ) : (
                'Place Order'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
