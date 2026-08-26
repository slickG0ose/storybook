import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import type { Book } from '../types'

interface BookCardProps {
  book: Book;
  /**
   * `wide` is the lead-slot treatment: cover on the left, copy on the right, on a card
   * that spans the full row. It exists so the Featured row can stop being three
   * identical columns without needing a second component to maintain.
   */
  variant?: 'default' | 'wide';
}

/** Ages and theme chips. Square-ish, not pills — pills are the default everything wears. */
function Chips({ book }: { book: Book }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-1 rounded-md font-semibold tnum">
        Ages {book.age_range}
      </span>
      <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-1 rounded-md font-semibold capitalize">
        {book.theme}
      </span>
    </div>
  )
}

export default function BookCard({ book, variant = 'default' }: BookCardProps) {
  const { addToCart } = useCart()
  const wide = variant === 'wide'

  /*
   * Motion lives on `transform`, not on `box-shadow` alone: the shadow still grows, but
   * the thing that actually moves is GPU-composited. `active:` gives the press a
   * physical bottom — the app previously had zero pressed states anywhere.
   */
  const surface =
    'group bg-white dark:bg-gray-800 rounded-[20px] shadow-card hover:shadow-card-hover ' +
    'transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 ' +
    'overflow-hidden flex h-full'

  const cover = (
    <Link
      to={`/book/${book.id}`}
      tabIndex={-1}
      aria-hidden="true"
      className={`no-underline shrink-0 ${wide ? 'w-full sm:w-2/5 md:w-1/3' : ''}`}
    >
      <div
        className={`flex items-center justify-center transition-transform duration-500 ease-out group-hover:scale-[1.06] ${
          wide ? 'h-36 text-6xl sm:h-full sm:min-h-44 sm:text-8xl' : 'h-36 sm:h-48 text-6xl sm:text-7xl'
        }`}
        style={{ backgroundColor: book.cover_color + '20' }}
      >
        <span className="drop-shadow-lg">{book.cover_emoji}</span>
      </div>
    </Link>
  )

  return (
    <article className={`${surface} ${wide ? 'flex-col sm:flex-row' : 'flex-col'}`}>
      {cover}

      <div className={`flex flex-col flex-1 ${wide ? 'p-5 sm:p-6' : 'p-4'}`}>
        <Link to={`/book/${book.id}`} className="no-underline">
          <h3
            className={`font-display font-bold text-gray-800 dark:text-gray-100 mb-1 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors ${
              wide ? 'text-lg sm:text-2xl md:text-3xl' : 'text-lg'
            }`}
          >
            {book.title}
          </h3>
        </Link>

        <p
          className={`text-gray-500 dark:text-gray-400 mb-3 ${
            wide ? 'text-sm sm:text-base line-clamp-2 sm:line-clamp-3 sm:max-w-[52ch]' : 'text-sm line-clamp-2'
          }`}
        >
          {book.description}
        </p>

        {/* mt-auto pins everything below to the card's floor, so the CTAs of a row of
            cards land on one line no matter how long the descriptions run. */}
        <div className="mt-auto flex flex-col">
          <div className="flex items-end justify-between gap-3 mb-3">
            <Chips book={book} />
            <span className="font-bold text-gray-800 dark:text-gray-100 tnum shrink-0">
              ${book.price.toFixed(2)}
            </span>
          </div>

          <button
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.preventDefault(); void addToCart(book.id) }}
            className={`py-3 rounded-xl font-semibold text-sm cursor-pointer transition-[background-color,color,transform] duration-150 active:scale-[0.98] ${
              wide
                ? 'w-full sm:w-auto sm:px-8 sm:self-start bg-purple-500 hover:bg-purple-600 text-white'
                : 'w-full bg-purple-100 text-purple-700 hover:bg-purple-500 hover:text-white dark:bg-purple-800/60 dark:text-purple-100 dark:hover:bg-purple-500 dark:hover:text-white'
            }`}
          >
            Add to Cart
          </button>
        </div>
      </div>
    </article>
  )
}
