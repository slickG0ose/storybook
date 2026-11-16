import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

/**
 * Privacy note for the friends-and-family test (#117, privacy half only).
 *
 * Every claim here was checked against the code on 2026-11-16, not written from
 * memory. If one of these changes, change this page in the same PR:
 *   - account fields + scrypt hash ............ server/prisma/schema.prisma, server/src/lib/password.ts
 *   - published books readable signed-out ..... GET /api/books has no auth (server/src/routes/books.ts)
 *   - style upload sent to Anthropic .......... server/src/routes/uploads.ts
 *   - pictures + voices from fal.ai ........... IMAGE_PROVIDER default 'fal' (services/illustrations.ts),
 *                                               services/narration/falKokoro.ts. If prod is switched to
 *                                               IMAGE_PROVIDER=openai, OpenAI must be named here.
 *   - feedback fields ......................... Feedback model in schema.prisma
 *   - deleting a book is a soft delete ........ DELETE /api/books/:id
 *   - no self-serve account deletion .......... there is no such route; removal is manual
 *   - no analytics, self-hosted fonts ......... client/index.html, client/src/index.css (#126)
 *
 * Plain language on purpose: this is a note for invited testers, not legal text.
 */

const H2 = 'text-xl font-bold text-gray-800 dark:text-gray-100 font-display mt-10 mb-3'
const P = 'text-gray-700 dark:text-gray-300 leading-relaxed mb-3'
const LIST = 'list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300 leading-relaxed mb-3'
const STRONG = 'font-semibold text-gray-800 dark:text-gray-100'

export default function Privacy() {
  return (
    <article className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 mb-5">
        <ShieldCheck size={28} aria-hidden="true" />
      </div>

      <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100 font-display mb-3">Privacy</h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Last updated November 16, 2026</p>

      <p className={P}>
        StoryBook is in a small test with invited family and friends. This page says what it keeps about you,
        who helps run it, and how to have your data removed.
      </p>

      <h2 className={H2}>What StoryBook keeps</h2>
      <ul className={LIST}>
        <li>
          <span className={STRONG}>Your account:</span> your name, your email, and your password, which is stored
          only as a one-way hash. Your name shows as the author of books you make.
        </li>
        <li>
          <span className={STRONG}>Your books:</span> what you type when you make one (theme, character names and
          descriptions, extra details), plus the story, pictures and read-aloud audio made from it.
        </li>
        <li>
          <span className={STRONG}>Style pictures:</span> any picture you upload to set the art style.
        </li>
        <li>
          <span className={STRONG}>Feedback:</span> your message, plus the page you were on, your browser type and
          screen size, light or dark mode, the app version, and recent error messages, so bugs can be traced.
        </li>
        <li>
          <span className={STRONG}>Usage:</span> what you generated and when, so spending stays capped.
        </li>
      </ul>
      <p className={P}>
        Your browser also keeps your sign-in (it expires after 30 days), your theme, your read-aloud settings, and
        an unfinished book while the tab is open.
      </p>

      <h2 className={H2}>About children's details</h2>
      <p className={P}>
        Stories often star a real child. A first name or nickname works fine. Please leave out last names, schools,
        addresses and other details that could identify a child, and don't upload photos of children as style
        pictures.
      </p>

      <h2 className={H2}>Who can see your books</h2>
      <ul className={LIST}>
        <li>A draft is visible only to you.</li>
        <li>
          A <span className={STRONG}>published</span> book can be read by anyone who visits the site, without
          signing in. You can unpublish it any time from <Link to="/my-books" className="text-purple-600 dark:text-purple-300 underline">Your library</Link>.
        </li>
        <li>
          Pictures and audio are stored at web addresses that are hard to guess but not password-protected.
        </li>
        <li>The person running this test can see accounts, books and feedback.</li>
      </ul>

      <h2 className={H2}>Services that help run StoryBook</h2>
      <ul className={LIST}>
        <li>
          <span className={STRONG}>Anthropic (Claude)</span> writes the stories. It receives what you type for a
          book, and any style picture you upload so it can describe the art style.
        </li>
        <li>
          <span className={STRONG}>fal.ai</span> draws the pictures and makes the read-aloud voices. It receives
          picture descriptions built from your story, and the story text.
        </li>
        <li>
          <span className={STRONG}>Cloudflare</span> stores the pictures and audio, <span className={STRONG}>Neon</span>{' '}
          holds the database, <span className={STRONG}>Render</span> runs the server, and{' '}
          <span className={STRONG}>GitHub Pages</span> serves the website.
        </li>
      </ul>
      <p className={P}>
        StoryBook has no ads and no tracking or analytics, and it doesn't sell your data. Like most websites, its
        hosts may keep basic visit logs.
      </p>

      <h2 className={H2}>Removing your data</h2>
      <p className={P}>
        Deleting a book hides it, but a copy is kept for now so it can be restored. To have your account and all
        your books removed for good, send a request with the Feedback button (when signed in), or ask the person who
        invited you.
      </p>
    </article>
  )
}
