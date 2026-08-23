import { test, expect, type Page } from '@playwright/test';
import {
  BOOK_ID,
  ILLUSTRATED_PAGES,
  MIXED_PAGES,
  deleteUsers,
  installBookMocks,
  registerOwner,
  seedAuth,
  type RegisteredUser,
} from './_editPublished';

/**
 * "Withdraw to edit" desktop e2e (#20, Task 7).
 *
 * Covers the author's full loop — published -> confirm -> draft -> publish -> published — and
 * the immutability fence: while a book is in the catalog, **no** editing affordance is
 * reachable in either view mode. That fence is the client half of the model; the server half
 * (six mutating routes returning 403 on a published book, and 404 rather than 403 to a
 * non-owner) is proven under Supertest in Task 1.
 *
 * Auth is real, the book is route-mocked. The reasoning, and what it costs, is in
 * `_editPublished.ts`.
 */

/** Every publish-state assertion is scoped to `PublishStateBar`'s `<section aria-label>`. */
const publishStateBar = (page: Page) => page.getByRole('region', { name: 'Publish state' });

/**
 * The surfaces that exist only for a draft the signed-in user owns. Each is a distinct
 * `isOwner && isDraft` site in `BookDetail.tsx` / `BookSpread.tsx`, so asserting all of them
 * catches a gate that regresses in one place but not the others.
 */
const draftOnlySurfaces = (page: Page) => [
  page.getByRole('heading', { name: 'Cast portraits' }),
  page.getByRole('heading', { name: 'Version history' }),
  page.getByRole('heading', { name: 'Revise Your Story' }),
  page.getByRole('button', { name: /Illustrate All/ }),
  page.getByRole('button', { name: 'Suggest changes' }),
];

test.describe('Edit published books — the desktop loop and the immutability fence', () => {
  let user: RegisteredUser;
  const createdEmails: string[] = [];

  test.beforeEach(async ({ request }) => {
    user = await registerOwner(request, 'edit-published');
    createdEmails.push(user.email);
  });

  test.afterAll(async ({ request }) => {
    await deleteUsers(request, createdEmails);
  });

  test('the loop: published -> take it out and edit -> publish changes -> published', async ({
    page,
  }) => {
    const mocks = await installBookMocks(page, {
      status: 'published',
      createdBy: user.id,
      pages: ILLUSTRATED_PAGES,
      token: user.token,
    });
    await seedAuth(page, user);

    await page.goto(`/book/${BOOK_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pip Goes to the Mountains');

    // --- In the catalog. No editing surface is reachable.
    const bar = publishStateBar(page);
    await expect(bar.getByText('In the catalog', { exact: true })).toBeVisible();
    await expect(
      bar.getByText('Readers can find and buy this book. Editing it means taking it out first.'),
    ).toBeVisible();
    for (const surface of draftOnlySurfaces(page)) {
      await expect(surface).toHaveCount(0);
    }

    // --- Withdraw, behind the inline confirm.
    await bar.getByRole('button', { name: 'Edit this book' }).click();
    await expect(bar.getByText(/Editing takes/)).toContainText(
      'out of the catalog while you work',
    );
    await expect(bar.getByText(/keeps their receipt/)).toBeVisible();
    await bar.getByRole('button', { name: 'Take it out and edit' }).click();

    // --- Out of the catalog. Every draft-only surface mounts, with no other action.
    await expect(bar.getByText('Out of the catalog while you edit')).toBeVisible();
    expect(mocks.hits.unpublish).toBe(1);
    expect(mocks.status()).toBe('draft');
    for (const surface of draftOnlySurfaces(page)) {
      await expect(surface).toBeVisible();
    }
    // The summary is the page count, and it is singular-aware — `2 pages` here.
    await expect(bar.getByText('2 pages')).toBeVisible();

    // --- Republish. Fully illustrated, so no second confirm.
    await bar.getByRole('button', { name: 'Publish changes' }).click();
    await expect(bar.getByText('In the catalog', { exact: true })).toBeVisible();
    expect(mocks.hits.publish).toBe(1);
    expect(mocks.status()).toBe('published');
    await expect(bar.getByRole('button', { name: 'Edit this book' })).toBeVisible();
    await expect(bar.getByText('Out of the catalog while you edit')).toHaveCount(0);
    for (const surface of draftOnlySurfaces(page)) {
      await expect(surface).toHaveCount(0);
    }
  });

  test('cancelling the withdrawal confirm issues no unpublish request', async ({ page }) => {
    const mocks = await installBookMocks(page, {
      status: 'published',
      createdBy: user.id,
      pages: ILLUSTRATED_PAGES,
      token: user.token,
    });
    await seedAuth(page, user);

    await page.goto(`/book/${BOOK_ID}`);
    const bar = publishStateBar(page);
    const editButton = bar.getByRole('button', { name: 'Edit this book' });
    await expect(editButton).toBeVisible();

    await editButton.click();
    const confirmAction = bar.getByRole('button', { name: 'Take it out and edit' });
    await expect(confirmAction).toBeVisible();

    await bar.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmAction).toHaveCount(0);

    // Still in the catalog, and nothing was asked of the server.
    await expect(bar.getByText('In the catalog', { exact: true })).toBeVisible();
    await expect(bar.getByText('Out of the catalog while you edit')).toHaveCount(0);
    expect(mocks.hits.unpublish).toBe(0);
    expect(mocks.status()).toBe('published');
  });

  test('publishing a part-illustrated draft requires the second confirm', async ({ page }) => {
    const mocks = await installBookMocks(page, {
      status: 'draft',
      createdBy: user.id,
      pages: MIXED_PAGES,
      token: user.token,
    });
    await seedAuth(page, user);

    await page.goto(`/book/${BOOK_ID}`);
    const bar = publishStateBar(page);
    await expect(bar.getByText('Out of the catalog while you edit')).toBeVisible();
    await expect(bar.getByText('3 pages · 2 without an illustration')).toBeVisible();

    await bar.getByRole('button', { name: 'Publish changes' }).click();

    // The confirm is the second net under `POST /:id/revise`, which nulls `illustration_url`
    // on every changed page. Nothing is sent until it is answered.
    await expect(
      bar.getByText('2 of 3 pages have no illustration yet. Publish anyway?'),
    ).toBeVisible();
    expect(mocks.hits.publish).toBe(0);

    await bar.getByRole('button', { name: 'Publish anyway' }).click();
    await expect(bar.getByText('In the catalog', { exact: true })).toBeVisible();
    expect(mocks.hits.publish).toBe(1);
    expect(mocks.status()).toBe('published');
  });

  test('the fence: a published book exposes no illustration controls in either view mode', async ({
    page,
  }) => {
    await installBookMocks(page, {
      status: 'published',
      createdBy: user.id,
      pages: MIXED_PAGES,
      token: user.token,
    });
    await seedAuth(page, user);

    await page.goto(`/book/${BOOK_ID}`);

    // Positive control: this really is the published owner view, not a failed render.
    await expect(publishStateBar(page).getByRole('button', { name: 'Edit this book' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeVisible();

    // --- Spread view (the default). Advance past the cover so the page canvases render;
    // the per-page controls only exist for the spread currently on screen.
    await page.getByRole('button', { name: 'Next spread' }).click();
    await expect(page.getByText(MIXED_PAGES[0]!.text)).toBeVisible();
    for (const control of [
      page.getByRole('button', { name: 'Suggest changes' }),
      page.getByRole('button', { name: /Redo/ }),
      page.getByRole('button', { name: 'History' }),
      page.getByRole('button', { name: /Preview full prompt/ }),
      page.getByRole('button', { name: 'Generate illustration' }),
      page.getByRole('button', { name: /Illustrate All/ }),
    ]) {
      await expect(control).toHaveCount(0);
    }

    // --- Reader view. Page 1 is illustrated, so Regenerate/History are the controls that
    // would appear if `BookDetail.tsx:851` lost its `isDraft`.
    await page.getByRole('button', { name: 'Reader view' }).click();
    await expect(page.getByText(MIXED_PAGES[0]!.text)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'History' })).toHaveCount(0);

    // Page 2 has no illustration — the `:941` control.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(MIXED_PAGES[1]!.text)).toBeVisible();
    await expect(page.getByText(MIXED_PAGES[1]!.illustration_description)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate illustration' })).toHaveCount(0);
  });

  test('a non-owner sees no publish-state surface at all', async ({ page }) => {
    await installBookMocks(page, {
      status: 'published',
      createdBy: 'some-other-author-id',
      pages: ILLUSTRATED_PAGES,
    });
    await seedAuth(page, user);

    await page.goto(`/book/${BOOK_ID}`);

    // The reader view rendered — so the absences below are the gate, not a blank page.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pip Goes to the Mountains');
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeVisible();

    // A reader is told nothing about publish state — not even that the concept exists.
    await expect(publishStateBar(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit this book' })).toHaveCount(0);
    await expect(page.getByText('In the catalog', { exact: true })).toHaveCount(0);
  });
});
