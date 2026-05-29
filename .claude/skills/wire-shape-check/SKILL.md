---
name: wire-shape-check
mode: agent
description: Given a server route file, identify the response shape(s) it returns and verify the route's test file pins every response field by name with toMatchObject. Encodes OPS.3 / ADR-003 mechanically so the reviewer agent doesn't re-derive the rule each time.
argument-hint: "<route-file-path>  (e.g. server/src/routes/orders.ts)"
---

# wire-shape-check

The mechanical procedure for **reviewer Check 4 — Wire-shape assertion**. Given a server route file, this skill answers a single question: *does the matching test file pin every field the route returns?*

This skill exists so the reviewer agent (and `/code-review`, and ad-hoc dispatches) don't have to re-derive OPS.3 / ADR-003 from first principles every time. The rule is mechanical — encode it once, run it every PR.

## When to invoke

- **Reviewer agent**, Check 4, for every changed file under `server/src/routes/**/*.ts`.
- **Developer agent**, before marking a server task `Done`, as self-check.
- **Ad-hoc**, when you're touching a route and want to confirm the wire-shape rule is satisfied before opening a PR.

Skip this skill for routes that don't return JSON — see the **Binary carve-out** section.

## Inputs

- `<route-file-path>` — relative or absolute path to a file under `server/src/routes/**/*.ts`.

If the path doesn't resolve, or it's not under `server/src/routes/`, stop and report the misuse — don't try to be clever.

## Procedure

### Step 1 — Locate the test file

Convention (per `docs/conventions/testing.md`): `server/src/routes/foo.ts` → `server/src/routes/__tests__/foo.test.ts`.

If the test file is missing, that's a finding by itself:

> **Finding: wire-shape — no test file.** Route `<path>` has no matching `__tests__/*.test.ts`. The OPS.3 / ADR-003 rule is "every route has a wire-shape-asserted test" — a route without any test fails the check unconditionally.

Don't continue without a test file. Hand back.

### Step 2 — Enumerate response shapes in the route

For each request handler in the route file, find every place a 2xx response body is produced. Look for:

- `res.json({...})`
- `res.status(2xx).json({...})`
- `res.send(...)` returning an object (rare in this project — most routes use `res.json`)
- Bodies constructed via `validate({ response: SomeSchema })` middleware — in that case the response shape is `SomeSchema` from `@storybook/shared`.

For each handler, record:

| Handler | Method + path | Response shape source | Top-level fields |
|---|---|---|---|
| `createOrder` | `POST /api/orders` | `OrderCreateResponseSchema` (shared) | `id`, `customer_name`, `customer_email`, `status`, `items[]`, `total` |
| ... | ... | ... | ... |

Nested objects (e.g. `items[0]`) count as their own shape — they need their own assertion. Be explicit about every level of nesting that the route emits.

**Tip:** if the route uses `validate({ response: SomeSchema })`, the canonical response shape is the schema in `shared/src/<domain>.ts`. Read that file to confirm field names — don't trust handler reading alone, because middleware may strip or coerce fields.

### Step 3 — Verify the test pins every field

For each shape recorded in Step 2, open the test file and check it contains:

```ts
expect(res.body).toMatchObject({
  field1: expect.any(String),
  field2: expect.any(Number),
  ...
});
```

…or an equivalent (`toEqual` with a full object, `expect(res.body.foo).toBe(...)` for every field). The point is **every field name from the response shape appears verbatim in an assertion**, so a client/server name drift (e.g. `title` → `book_title`) fails the test immediately.

For nested arrays, the pattern is:

```ts
expect(res.body.items[0]).toMatchObject({
  book_id: expect.any(String),
  title: expect.any(String),
  quantity: expect.any(Number),
  price: expect.any(Number),
});
```

(See `server/src/routes/__tests__/orders.test.ts` for the canonical pattern.)

### Step 4 — Report per-handler

For each handler where the assertion is incomplete, report:

> **Finding: wire-shape — `<handler name>` (`<METHOD /path>`).** Response includes fields `<a, b, c>` but the test only asserts `<a, b>`. Field `<c>` would be silently renamed without a test failure.
> **Severity:** High (OPS.3 / ADR-003).
> **What to do:** add `<c>` to the `toMatchObject` block in `<test file>`.

For handlers where the assertion is complete, say so:

> `<handler name>`: wire-shape assertion complete — all `<N>` response fields pinned.

## Binary carve-out

Binary responses (PDF, file streams, image blobs) don't have a JSON shape to pin. The carve-out is documented in `.code-captain/specs/pdf-export/spec.md` and the `BookPdfRequestSchema` / `BookPdfErrorResponseSchema` pattern in `shared/src/pdf.ts`.

For binary routes, the wire-shape rule becomes:

1. **`Content-Type` assertion** — the test must assert the correct MIME type (e.g. `application/pdf`).
2. **Magic-bytes assertion** — the test must assert the first bytes of the response body match the format's signature (e.g. `%PDF-` for PDF).
3. **Error envelope assertion** — when the route can return JSON errors (e.g. 404, 500), the error shape must be pinned by `toMatchObject` like any other JSON route. The error schema is conventionally `<Domain>ErrorResponseSchema` in shared.

If the route is binary and the test omits any of those three, report:

> **Finding: wire-shape (binary) — `<handler>`.** Missing `<Content-Type | magic-bytes | error-envelope>` assertion.
> **Severity:** High.
> **What to do:** add the assertion per the PDF export spec pattern.

If the route is binary and all three are present, the handler passes.

## Edge cases

- **Error-only responses (4xx/5xx).** Error envelopes have their own shape — typically `{ error: string }`. The `validate()` middleware lets error envelopes pass through unvalidated, so the test must assert the error shape explicitly. Treat error envelopes as their own response shape.
- **Routes that 204 with no body.** Nothing to assert. Note in the report.
- **Routes that stream JSON (SSE, NDJSON).** Out of scope for this skill today — flag as `<not supported by skill>` and ask the human to review manually.
- **Routes that delegate to a service.** The shape is whatever the route emits, not what the service returns. Trace the data flow up to the `res.json` call.

## Output format

Always hand back a structured report, even when everything passes:

```
# wire-shape-check — <route file>

**Test file:** <path or "NOT FOUND">
**Handlers inspected:** <N>

## Findings

<one block per failing handler, using the templates above>

## Passed

<list each handler that passed, one line each>

## Notes

<edge cases, skipped handlers, anything the user should know>
```

A clean run is one paragraph; a failing run lists every offending field by name.

## What this skill does NOT do

- It does **not** fix the test. The skill is a check, not a code mutator. The reviewer agent doesn't have Edit/Write either — finding-then-handing-back is the entire interaction.
- It does **not** validate the schema definitions in `@storybook/shared`. It assumes those are correct; if they're wrong, that's an architect-level finding.
- It does **not** check that the response shape matches what the *client* consumes. Cross-package type-drift detection is out of scope — Vitest catching server-side drift is the goal here.

## Related

- `.claude/agents/reviewer.md` — Check 4 (this skill is the mechanical implementation).
- `docs/conventions/server.md` — "When adding a new route" steps 1 and 6.
- `docs/conventions/testing.md` — wire-shape assertion pattern with examples.
- `shared/src/*.ts` — the source of truth for every wire shape.
