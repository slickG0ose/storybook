# Client conventions

Stack and patterns under `client/`. The developer agent (HR5) reads this when editing the client zone.

**Stack:** React 19, Vite 8, Tailwind CSS v4, React Router v7, TypeScript (strict), Lucide React for icons.

## Layout

```
client/
  src/
    pages/                 # route-level components
    components/            # reusable building blocks
    context/
      AuthContext.tsx
      CartContext.tsx
      ThemeContext.tsx
    test/setup.ts          # vitest + RTL jsdom setup
    types.ts               # re-exports wire shapes from @storybook/shared
    App.tsx                # router routes + layout
    main.tsx               # provider chain + BrowserRouter bootstrap
    index.css              # Tailwind v4 entry point
  vite.config.ts
```

## Routing — React Router v7

- `main.tsx` wraps the app in `<BrowserRouter basename={import.meta.env.BASE_URL}>`. The basename is set by Vite's `base` config (driven by `VITE_BASE_PATH` env var so the app can serve under `/storybook/` on GitHub Pages).
- Routes are declared in `App.tsx`.
- **Always use `<Link>` from `react-router-dom`** for in-app navigation — never plain `<a href>`. Plain anchors trigger a full page reload and lose context state.

## Context providers — order matters

`main.tsx` chains four providers around `<App />`:

```
<BrowserRouter>
  <ThemeProvider>      ← reads localStorage, toggles `.dark` on <html>
    <AuthProvider>     ← stores token + user, calls /api/auth/me on mount
      <CartProvider>   ← session-scoped cart, depends on AuthProvider being mounted
        <App />
```

**If you add a new provider, place it inside the providers it depends on.** Cart needs auth context, auth needs theme context (for any error toasts that respect theme), all of them need router (for `useNavigate` etc.).

### Consuming a context

```ts
import { useCart } from '../context/CartContext';
const { items, addToCart } = useCart();
```

Contexts throw if used outside their provider — that's intentional. The test setup wraps components in providers manually (see `testing.md`).

## Styling — Tailwind v4

Tailwind v4 changed the config story significantly. We do **NOT** have a `tailwind.config.js`. Setup lives entirely in `client/src/index.css`:

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
```

The `@custom-variant dark` line is what makes the `dark:` prefix work against the `.dark` class on `<html>` (set by `ThemeContext`).

**This means:** Tailwind v3-era guides that tell you to edit `tailwind.config.js` do not apply. Custom themes go in `@theme {}` blocks inside `index.css` directly.

## Dark mode parity (LOAD-BEARING)

> **Every visual element needs both light and `dark:` classes.**

- Background, text, borders, hover states, focus rings — all of them.
- Missing dark variants are the #1 source of UI regression bugs in this project.
- Manually verify in browser in **both modes** before claiming a UI change complete (CLAUDE.md done criteria).

Pattern:

```tsx
<div className="bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700">
```

When in doubt, search for an existing component using the same surface (card, button, modal) and mirror its dark variants.

`ThemeContext` toggles `document.documentElement.classList.toggle('dark')` and persists the choice to `localStorage` under the key `storybook-theme`.

## Cart session — UUID-based, no login required (CLAUDE.md guardrail)

`CartContext` issues a UUID and stores it in `localStorage` under `storybook-session`. The cart API is session-scoped (`/api/cart/:sessionId/*`). This is load-bearing — **changing the session model requires user confirmation.**

When a user logs in, the cart stays attached to the session ID (no per-user persistence today). Cart is cleared on checkout via `clearCart()`.

## Auth (`AuthContext`)

- On mount: calls `/api/auth/me` with the token from `localStorage` (key `storybook-auth`). If 401, clears the token.
- `login`, `register`, `logout` methods call the matching `/api/auth/*` endpoint, then sync local state.
- Token is included as `Authorization: Bearer <token>` on every authed fetch.

## API calls — Vite dev proxy

`vite.config.ts` proxies `/api/*` to `http://localhost:3001`. In code, always use the relative form:

```ts
const res = await fetch('/api/books');
```

**Never** hardcode `http://localhost:3001` in client code — it breaks the production build (where client and server may be on different hosts) and breaks the GitHub Pages subpath deployment.

## TypeScript — strict, no `any`

- `tsconfig.json` has `strict: true`. Don't disable it; don't pepper `any` in.
- For inherently dynamic shapes (parsed JSON, third-party libs without types), narrow with `unknown` and type guards.
- Wire shapes come from `@storybook/shared` via `client/src/types.ts` re-exports. Don't duplicate the server's wire shape into the client.

## Accessibility — icon-only buttons need `aria-label`

The Playwright e2e suite (`e2e/tests/`) heavily uses `getByRole('button', { name: '...' })`. For buttons whose accessible name is just an icon (Lucide `<Trash />`, `<Plus />`, etc.), the test selectors will fail unless you provide an `aria-label`:

```tsx
<button aria-label="Decrease quantity" onClick={...}>
  <Minus size={16} />
</button>
```

Pick the aria-label from the user's perspective ("Decrease quantity") not the implementation ("Minus icon"). This is also what screen readers announce.

## When adding a new component

1. **Mirror existing dark-mode patterns** for every surface and state.
2. **`aria-label`** any icon-only interactive element.
3. **Use `<Link>` for navigation**, not `<a>`.
4. **Add an RTL test** in `components/__tests__/` — see `docs/conventions/testing.md` for the provider-wrapping pattern.
5. **Verify in browser** in both light and dark mode before claiming done.

## When adding a new page

1. Mount the route in `App.tsx`.
2. Read URL params via `useParams()`; for navigation use `useNavigate()`.
3. If the page needs auth, gate with `useAuth()` and redirect when the user isn't authenticated.
4. Pages live in `client/src/pages/`. Keep them thin — push reusable UI into `components/`.

## Things to NEVER do without user confirmation (CLAUDE.md guardrails)

- Modify the session/auth model (UUID session model is load-bearing).
- Delete tests instead of fixing them.
- Add a new paid external API call (e.g. image generation, payments).
