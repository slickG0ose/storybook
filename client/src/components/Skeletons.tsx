/**
 * Loading placeholders shaped like the page they stand in for.
 *
 * My Books and the book page used to show a line of grey text while loading, then
 * swap the whole page in. A skeleton holds the layout's rough shape so the arrival
 * reads as content filling in rather than the page being replaced.
 *
 * Each one is a single polite live region with screen-reader text; the grey blocks
 * are decoration and hidden from assistive tech. `animate-pulse` is collapsed by the
 * reduced-motion block in index.css like every other animation.
 */
const BLOCK = 'bg-gray-100 dark:bg-gray-700 animate-pulse'

function Status({ label, className, children }: { label: string; className: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

/** Mirrors My Books: heading row, the three tab chips, a grid of cover cards. */
export function MyBooksSkeleton() {
  return (
    <Status label="Loading your books" className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className={`h-9 w-40 rounded-lg ${BLOCK}`} />
        <div className={`h-9 w-36 rounded-full ${BLOCK}`} />
      </div>
      <div className="flex gap-2 mb-6">
        <div className={`h-8 w-20 rounded-full ${BLOCK}`} />
        <div className={`h-8 w-24 rounded-full ${BLOCK}`} />
        <div className={`h-8 w-24 rounded-full ${BLOCK}`} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
            <div className={`h-48 ${BLOCK}`} />
            <div className="p-4 space-y-3">
              <div className={`h-5 w-3/4 rounded ${BLOCK}`} />
              <div className={`h-3 w-full rounded ${BLOCK}`} />
              <div className={`h-3 w-5/6 rounded ${BLOCK}`} />
              <div className="flex gap-2 pt-1">
                <div className={`h-9 w-28 rounded-lg ${BLOCK}`} />
                <div className={`h-9 w-20 rounded-lg ${BLOCK}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Status>
  )
}

/** Mirrors the book page: back link, the cover-and-details card, the reading spread. */
export function BookDetailSkeleton() {
  return (
    <Status label="Loading the book" className="max-w-4xl mx-auto px-4 py-8">
      <div className={`h-5 w-36 rounded mb-6 ${BLOCK}`} />
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-lg overflow-hidden mb-8 md:flex">
        <div className={`h-64 md:h-auto md:min-h-80 md:w-2/5 ${BLOCK}`} />
        <div className="p-6 sm:p-8 space-y-4 md:flex-1">
          <div className={`h-9 w-4/5 rounded-lg ${BLOCK}`} />
          <div className={`h-4 w-32 rounded ${BLOCK}`} />
          <div className="space-y-2 pt-2">
            <div className={`h-3 w-full rounded ${BLOCK}`} />
            <div className={`h-3 w-full rounded ${BLOCK}`} />
            <div className={`h-3 w-2/3 rounded ${BLOCK}`} />
          </div>
          <div className="flex gap-2 pt-2">
            <div className={`h-7 w-20 rounded-md ${BLOCK}`} />
            <div className={`h-7 w-24 rounded-md ${BLOCK}`} />
          </div>
          <div className={`h-12 w-44 rounded-xl ${BLOCK}`} />
        </div>
      </div>
      <div className={`h-72 sm:h-96 rounded-3xl ${BLOCK}`} />
    </Status>
  )
}
