import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for books to load by waiting for an "Add to Cart" button to appear
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
  });

  test('loads with the hero section containing "Stories Made with Magic"', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Magic');
  });

  test('displays seed books and community demo', async ({ page }) => {
    // 3 featured + 1 community + 7 all-books = 11 total "Add to Cart" buttons (featured books appear in both Featured and All Books)
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(11);
  });

  test('renders the Community Creations section with the demo book', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Community Creations/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A Spot for Sunny' }).first()).toBeVisible();
  });

  test('clicking a theme filter reduces the visible books', async ({ page }) => {
    await page.getByRole('button', { name: 'fantasy' }).click();
    // fantasy theme has 1 seed book; featured section hidden when filter active
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(1);
  });

  test('clicking "All" shows all books again', async ({ page }) => {
    await page.getByRole('button', { name: 'fantasy' }).click();
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(1);

    await page.getByRole('button', { name: 'All' }).first().click();
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(11);
  });
});
