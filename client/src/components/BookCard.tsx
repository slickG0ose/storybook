import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import type { Book } from '../types'

interface BookCardProps {
  book: Book;
}

export default function BookCard({ book }: BookCardProps) {
  const { addToCart } = useCart()

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden group">
      <Link to={`/book/${book.id}`} className="no-underline">
        <div
          className="h-36 sm:h-48 flex items-center justify-center text-6xl sm:text-7xl transition-transform duration-300 group-hover:scale-105"
          style={{ backgroundColor: book.cover_color + '20' }}
        >
          <span className="drop-shadow-lg">{book.cover_emoji}</span>
        </div>
      </Link>
      <div className="p-4">
        <Link to={`/book/${book.id}`} className="no-underline">
          <h3 className="font-display text-lg font-bold text-gray-800 dark:text-gray-100 mb-1 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
            {book.title}
          </h3>
        </Link>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-2 line-clamp-2">{book.description}</p>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">
              Ages {book.age_range}
            </span>
            <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full font-semibold ml-1 capitalize">
              {book.theme}
            </span>
          </div>
          <span className="font-bold text-gray-800 dark:text-gray-100">${book.price.toFixed(2)}</span>
        </div>
        <button
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.preventDefault(); void addToCart(book.id) }}
          className="mt-3 w-full bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500 text-white py-3 rounded-xl font-semibold text-sm transition-colors cursor-pointer"
        >
          Add to Cart
        </button>
      </div>
    </div>
  )
}
