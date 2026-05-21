import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { CheckCircle, BookOpen } from 'lucide-react'
import type { Order } from '../types'

export default function OrderConfirmation() {
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then(r => r.json())
      .then((data: Order) => { setOrder(data); setLoading(false) })
  }, [id])

  if (loading) return <div className="text-center py-20 text-gray-400 text-lg">Loading...</div>
  if (!order) return <div className="text-center py-20 text-gray-400 text-lg">Order not found</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-center">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg p-10 transition-colors">
        <CheckCircle size={64} className="text-green-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 font-display mb-2">Order Confirmed!</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Thank you, {order.customer_name}! Your magical books are on their way.
        </p>

        <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-6 text-left mb-6">
          <div className="text-sm text-green-600 dark:text-green-400 font-semibold mb-3">Order #{order.id.slice(0, 8)}</div>
          <div className="space-y-2">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{item.title} x{item.quantity}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <hr className="my-3 border-green-200 dark:border-green-800" />
          <div className="flex justify-between font-bold text-gray-800 dark:text-gray-100">
            <span>Total</span>
            <span>${order.total.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-xl font-bold no-underline transition-colors"
          >
            <BookOpen size={18} />
            Continue Browsing
          </Link>
          <Link
            to="/create"
            className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-xl font-bold no-underline hover:shadow-lg transition-shadow"
          >
            Create Another Book
          </Link>
        </div>
      </div>
    </div>
  )
}
