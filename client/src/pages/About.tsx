import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'

/**
 * About page for the friends-and-family test: what StoryBook is for and who it serves.
 *
 * Copy approved by the owner on 2026-11-27 (first paragraph reworded so the family is the author). Every feature named here was checked
 * against the code on 2026-11-24, not written from memory. If one changes, change this
 * page in the same PR:
 *   - ages 2 to 9 ............................. AgeRangeSchema in shared/src/books.ts ('2-5' … '5-9')
 *   - themes + art styles ..................... THEMES / STYLE_PRESETS in pages/CreateBook.tsx
 *   - hero, family, friends, pets, a villain .. cast step ("Build Your Cast") in pages/CreateBook.tsx
 *   - read aloud .............................. components/NarrationPlayer.tsx
 *   - ask for changes in plain words .......... revise modal in pages/BookDetail.tsx
 *   - download a PDF .......................... downloadBookPdf in pages/BookDetail.tsx
 *   - private by default, no ads/tracking ..... see the claims list at the top of pages/Privacy.tsx
 *
 * The framing is deliberate: the family makes the story and AI helps. Keep "StoryBook
 * writes your book" style wording out of here and out of the home page and meta tags.
 */

const H2 = 'text-xl font-bold text-gray-800 dark:text-gray-100 font-display mt-10 mb-3'
const P = 'text-gray-700 dark:text-gray-300 leading-relaxed mb-3'
const LIST = 'list-decimal pl-6 space-y-2 text-gray-700 dark:text-gray-300 leading-relaxed mb-3'
const STRONG = 'font-semibold text-gray-800 dark:text-gray-100'
const BUTTON =
  'inline-flex items-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-full font-bold no-underline shadow-accent hover:shadow-none transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.97]'
const TEXT_LINK = 'text-purple-600 dark:text-purple-300 underline'

export default function About() {
  return (
    <article className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 mb-5">
        <Sparkles size={28} aria-hidden="true" />
      </div>

      <p className="text-sm font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300 mb-2">
        About StoryBook
      </p>
      <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100 font-display mb-5">
        Stories your family makes together
      </h1>

      <p className={P}>
        StoryBook turns your child's ideas into an illustrated picture book you can read together. You pick the
        theme and choose who's in the story, and StoryBook's AI helps you write it, draw it and even read it aloud.
      </p>

      <h2 className={H2}>Who it's for</h2>
      <p className={P}>
        Kids who are full of ideas, and the parents, grandparents and grown-ups who love reading with them. Stories
        are written for ages 2 to 9. Your child can be the hero, with brothers and sisters, friends, pets and even a
        villain along for the ride.
      </p>

      <h2 className={H2}>How it works</h2>
      <ol className={LIST}>
        <li>
          <span className={STRONG}>Pick a theme and an art style.</span> Adventure, space, animals, friendship and
          more, drawn in watercolor, crayon, classic storybook or another style.
        </li>
        <li>
          <span className={STRONG}>Build your cast and add the details.</span> Name the hero, bring in family,
          friends and pets, and add anything else you'd like: a lesson, a setting, a favorite toy.
        </li>
        <li>
          <span className={STRONG}>Read it together, then make it yours.</span> Turn the pages, listen to it read
          aloud, ask for changes in plain words ("make the ending happier"), and download a PDF to keep.
        </li>
      </ol>

      <h2 className={H2}>Why StoryBook</h2>
      <p className={P}>
        AI can be a wonderful creative partner for a family, but most of it takes accounts, apps and setup before
        you get to anything fun. StoryBook handles all of that for you. There are no AI accounts, keys or apps to set
        up, so your time goes to the good part: dreaming up a story, talking about what happens next, and watching
        your child's ideas turn into a real book.
      </p>
      <p className={P}>
        The best stories still start with your kids. StoryBook is here to help them imagine bigger, not to imagine
        for them.
      </p>

      <h2 className={H2}>Private by default</h2>
      <p className={P}>
        Every book you make starts private, so only you can see it, and you decide if one ever goes public.
        StoryBook has no ads and no tracking, and it doesn't sell your data. A first name or nickname is all a story
        needs.{' '}
        <Link to="/privacy" className={TEXT_LINK}>
          Read the privacy page
        </Link>
      </p>

      <h2 className={H2}>Every child has a story in them</h2>
      <p className={`${P} mb-6`}>Let's make one together.</p>
      <Link to="/create" className={BUTTON}>
        <Sparkles size={18} aria-hidden="true" />
        Start your story
      </Link>
    </article>
  )
}
