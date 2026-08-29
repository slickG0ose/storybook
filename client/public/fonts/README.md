# Self-hosted webfonts

Vendored from Google Fonts (#126) so the browser never makes a third-party round trip for
text. Both faces are SIL Open Font License 1.1; the licences ship alongside the binaries
as `Fredoka-OFL.txt` and `Nunito-OFL.txt`, which is what the OFL requires.

| File | Family | Version | Subset | Size |
|------|--------|---------|--------|------|
| `fredoka-latin.woff2` | Fredoka | v17 | latin | 29 KB |
| `fredoka-latin-ext.woff2` | Fredoka | v17 | latin-ext | 4.5 KB |
| `nunito-latin.woff2` | Nunito | v32 | latin | 38 KB |
| `nunito-latin-ext.woff2` | Nunito | v32 | latin-ext | 35 KB |

## Four files, not eight

Both families are **variable** fonts on Google's CDN. The `css2?...wght@400;500;600;700`
response emits four `@font-face` blocks per subset, but all four point at the *same*
woff2 — the weight axis lives inside the file. So one file per family per subset covers
the whole 400-700 range, declared as `font-weight: 400 700` in `src/index.css`.

Do not "fix" that range to a single weight. Narrowing it makes the browser synthesise the
other three by faux-bolding, which looks visibly wrong on Fredoka in particular.

## Refreshing them

The URLs are versioned (`/s/fredoka/v17/`, `/s/nunito/v32/`), so these bytes are stable
and there is no drift to chase. To pull a newer cut, request the css2 URL with a modern
browser User-Agent - with a bare curl UA Google serves the legacy TTF path instead of
woff2 - take the `latin` and `latin-ext` URLs, and re-copy the OFL from
`github.com/google/fonts/ofl/<family>/OFL.txt`. Update the version column above.

Subsetting stops at latin-ext deliberately. Google also serves hebrew for Fredoka and
cyrillic / cyrillic-ext / vietnamese for Nunito; the catalog has no copy needing them,
and each is dead weight on every visitor. Add a subset when content needs it.
