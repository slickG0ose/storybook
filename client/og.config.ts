import type { Plugin } from 'vite';

/**
 * Open Graph URLs must be absolute — scheme and host — or several major scrapers will not
 * resolve them at all and the card renders with no image (#120).
 *
 * They cannot simply be hard-coded, because this app builds for two different origins
 * (GitHub Pages and Render) and, at the time of writing, is deployed to neither (#77).
 * Writing a guessed origin into index.html would be inventing a fact. So the origin
 * arrives at build time as `VITE_PUBLIC_ORIGIN` and this plugin injects it.
 *
 * When the variable is unset the tag is left exactly as authored — root-relative. That is
 * the status quo, which is wrong for scrapers but right for the browser, so an unset
 * variable is a no-op rather than a regression.
 */

/** Matches the `content` of an og:/twitter: meta tag whose value is a root-relative path. */
const ROOT_RELATIVE_OG_META =
  /(<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content=")(\/[^"]*)(")/g;

export class InvalidPublicOriginError extends Error {}

/**
 * Normalise the configured origin, or throw.
 *
 * Deliberately strict and deliberately fatal. A malformed origin produces a meta tag that
 * is broken in a way nothing in CI would catch — the build succeeds, the page renders, and
 * only a scraper months later reports the miss. Failing the build is the cheaper failure.
 */
export function normalisePublicOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidPublicOriginError(
      `VITE_PUBLIC_ORIGIN must be an absolute URL with a scheme, e.g. https://example.com — got ${JSON.stringify(raw)}`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidPublicOriginError(
      `VITE_PUBLIC_ORIGIN must be http or https — got ${JSON.stringify(raw)}`,
    );
  }

  // Only the origin is used. A path, query, or fragment in the variable would be silently
  // dropped when joined with the already-base-prefixed asset path, so say so instead.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new InvalidPublicOriginError(
      `VITE_PUBLIC_ORIGIN must be an origin only, with no path, query, or fragment — got ${JSON.stringify(raw)}`,
    );
  }

  return url.origin;
}

/**
 * Rewrite root-relative og:image / twitter:image values to absolute.
 *
 * Only the origin is prepended, never the base path. By the time this runs Vite has
 * already rewritten the path for `base` (that is what `order: 'post'` buys), so joining
 * the base again here would produce `/storybook/storybook/icons/...`.
 */
export function absolutiseOgUrls(html: string, origin: string): string {
  return html.replace(ROOT_RELATIVE_OG_META, (_match, open: string, path: string, close: string) =>
    `${open}${origin}${path}${close}`,
  );
}

export function ogAbsoluteUrls(env: NodeJS.ProcessEnv = process.env): Plugin {
  return {
    name: 'storybook:og-absolute-urls',
    enforce: 'post',
    transformIndexHtml: {
      // 'post' so this sees the HTML *after* Vite has applied `base` to the path.
      order: 'post',
      handler(html) {
        const raw = env.VITE_PUBLIC_ORIGIN?.trim();
        if (!raw) return html;
        return absolutiseOgUrls(html, normalisePublicOrigin(raw));
      },
    },
  };
}
