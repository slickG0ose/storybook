# Self-hosted webfonts

Vendored from Google Fonts (#126, #113) so the browser never makes a third-party round trip
for text. All four faces are SIL Open Font License 1.1; the licences ship alongside the
binaries as `Fredoka-OFL.txt`, `Nunito-OFL.txt`, `AtkinsonHyperlegible-OFL.txt` and
`Lexend-OFL.txt`, which is what the OFL requires.

| File | Family | Version | Subset | Size |
|------|--------|---------|--------|------|
| `fredoka-latin.woff2` | Fredoka | v17 | latin | 29 KB |
| `fredoka-latin-ext.woff2` | Fredoka | v17 | latin-ext | 4.5 KB |
| `nunito-latin.woff2` | Nunito | v32 | latin | 38 KB |
| `nunito-latin-ext.woff2` | Nunito | v32 | latin-ext | 35 KB |
| `atkinson-latin.woff2` | Atkinson Hyperlegible (400) | v12 | latin | 11 KB |
| `atkinson-latin-ext.woff2` | Atkinson Hyperlegible (400) | v12 | latin-ext | 5.8 KB |
| `atkinson-700-latin.woff2` | Atkinson Hyperlegible (700) | v12 | latin | 11 KB |
| `atkinson-700-latin-ext.woff2` | Atkinson Hyperlegible (700) | v12 | latin-ext | 5.8 KB |
| `lexend-latin.woff2` | Lexend | v26 | latin | 39 KB |
| `lexend-latin-ext.woff2` | Lexend | v26 | latin-ext | 34 KB |

Fredoka and Nunito are the storefront's display and body faces and load on every page.
Atkinson Hyperlegible and Lexend are **author-selectable story faces** (#113) that no
default style references — an unused `@font-face` is never fetched, so they cost a visitor
reading a Fredoka book nothing. For that same reason they are deliberately **not** in
`index.html`'s `<link rel="preload">` pair; preloading a face no page may use is the one
way to make them cost every visitor bytes.

## Two files per family, except Atkinson

Fredoka, Nunito and Lexend are **variable** fonts on Google's CDN. The
`css2?...wght@400..700` response emits several `@font-face` blocks per subset, but they all
point at the *same* woff2 — the weight axis lives inside the file. So one file per family
per subset covers the whole 400-700 range, declared as `font-weight: 400 700` in
`src/index.css`.

Do not "fix" that range to a single weight. Narrowing it makes the browser synthesise the
other weights by faux-bolding, which looks visibly wrong on Fredoka in particular.

**Atkinson Hyperlegible is static, not variable** — Google ships 400 and 700 as separate
files, so it has four here to the others' two, and each is declared at its own single
weight rather than as a range. The inverse of the rule above applies: do not collapse them
into `font-weight: 400 700`, because a range on a static face is a claim the browser
satisfies by picking one file and faux-bolding the rest. A 500 or 600 request resolves to
the 400 file with no synthesis, which is correct for a face with no intermediate cut.
Google's newer *Atkinson Hyperlegible Next* is a variable cut, but it is a different family
under a different licence file and is not what #113 approved.

## Refreshing them

The URLs are versioned (`/s/fredoka/v17/`, `/s/nunito/v32/`, `/s/atkinsonhyperlegible/v12/`,
`/s/lexend/v26/`), so these bytes are stable and there is no drift to chase. To pull a newer
cut, request the css2 URL with a modern browser User-Agent - with a bare curl UA Google
serves the legacy TTF path instead of woff2 - take the `latin` and `latin-ext` URLs, and
re-copy the OFL from `github.com/google/fonts/ofl/<family>/OFL.txt`. Update the version
column above.

Subsetting stops at latin-ext deliberately. Google also serves hebrew for Fredoka,
cyrillic / cyrillic-ext / vietnamese for Nunito, and vietnamese for Lexend; the catalog has
no copy needing them, and each is dead weight on every visitor. Add a subset when content
needs it.
