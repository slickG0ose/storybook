import heroArt960 from '../assets/hero/spot-for-sunny-bench-960.webp'
import heroArt480 from '../assets/hero/spot-for-sunny-bench-480.webp'

// Describes the artwork, not the product: the hero image is a page from a real
// seeded book, so its alt text is what a sighted reader sees, not a sales line.
export const HERO_ALT =
  'Watercolour illustration of two young girls sitting side by side on a wooden bench ' +
  'under a leafy tree, an orange backpack between them, one turning to greet the other.'

/**
 * The Home hero's art column, lifted out of `Home.tsx` unchanged (#127).
 *
 * The illustration is an opaque square on pale cream paper: on the cream surface it
 * blends at the edges, but on gray-900 it would butt a bright square against near-black
 * and glare. The mat carries the app's existing card language so the art reads as a page
 * from a book and gets a mid-tone surround in dark mode — no filter on the image itself,
 * which is the one thing the hero exists to show off.
 *
 * Layer 0 is the LCP candidate. Its `<img>`, its `src`, and its attributes are never
 * mutated — rotation adds a sibling layer above it rather than re-`src`ing this one.
 * See `.code-captain/specs/hero-rotation/spec.md` §4.
 */
export default function HeroArt() {
  return (
    <div className="w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[440px] justify-self-center lg:justify-self-end lg:mt-4">
      <div className="p-2 sm:p-2.5 bg-white dark:bg-gray-800 rounded-[24px] shadow-card ring-1 ring-gray-200 dark:ring-gray-700">
        {/* The positioning context every future layer stacks into. It lives here so the
            rotation commit adds no layout of its own — and `aspect-square` stays on the
            `<img>` as well, because that is what the intrinsic `width`/`height` pin is
            paired with. */}
        <div className="relative aspect-square">
          {/* Frame 0. No `loading="lazy"`: this is above the fold and is the LCP
              candidate. `width`/`height` plus `aspect-square` reserve the box before the
              bytes land, so nothing shifts on a slow connection. */}
          <img
            src={heroArt960}
            srcSet={`${heroArt480} 480w, ${heroArt960} 960w`}
            sizes="(min-width: 1024px) 440px, 300px"
            width={960}
            height={960}
            alt={HERO_ALT}
            decoding="async"
            fetchPriority="high"
            className="w-full aspect-square object-cover rounded-[16px]"
          />
        </div>
      </div>
    </div>
  )
}
