import { test, expect } from '@playwright/test';

test.describe('Cart and checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
  });

  test('adding a book from the catalog puts it in the cart', async ({ page }) => {
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();

    const cartBadge = page.locator('nav .bg-red-500');
    await expect(cartBadge).toHaveText('1');
  });

  test('cart page shows the item with correct title and price', async ({ page }) => {
    const firstTitle = await page.getByRole('heading', { level: 3 }).first().textContent();
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await expect(page.locator('nav .bg-red-500')).toHaveText('1');

    await page.goto('/cart');
    await expect(page.getByText(firstTitle!)).toBeVisible();
    await expect(page.getByText(/\$\d+\.\d{2} each/)).toBeVisible();
  });

  test('quantity +/- buttons work', async ({ page }) => {
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await expect(page.locator('nav .bg-red-500')).toHaveText('1');
    await page.goto('/cart');

    await expect(page.getByRole('button', { name: 'Decrease quantity' })).toBeVisible();

    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByText('2').first()).toBeVisible();

    await page.getByRole('button', { name: 'Decrease quantity' }).click();
    await expect(page.getByText('1').first()).toBeVisible();
  });

  test('removing an item empties the cart', async ({ page }) => {
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await expect(page.locator('nav .bg-red-500')).toHaveText('1');
    await page.goto('/cart');

    await expect(page.getByRole('button', { name: 'Remove from cart' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove from cart' }).click();

    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });

  test('full checkout flow: add -> cart -> checkout -> order confirmation', async ({ page }) => {
    const firstTitle = await page.getByRole('heading', { level: 3 }).first().textContent();
    expect(firstTitle).toBeTruthy();

    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await expect(page.locator('nav .bg-red-500')).toHaveText('1');

    await page.goto('/cart');
    await expect(page.getByText('Your Cart')).toBeVisible();

    await page.getByRole('link', { name: 'Proceed to Checkout' }).click();
    await expect(page).toHaveURL('/checkout');

    await page.locator('input[type="text"]').fill('Test User');
    await page.locator('input[type="email"]').fill('test@example.com');
    await page.getByRole('button', { name: 'Place Order' }).click();

    await expect(page).toHaveURL(/\/order\/.+/);
    await expect(page.getByText('Order Confirmed!')).toBeVisible();

    // Wire-shape guard: the confirmation must render the actual book title alongside the quantity,
    // not a blank/undefined placeholder. Catches server↔client field-name drift on OrderItem.
    await expect(page.getByText(`${firstTitle} x1`)).toBeVisible();
  });
});
