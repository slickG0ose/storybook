import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';

const TEST_SESSION = 'test-session-orders';

describe('Orders API routes', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  describe('POST /api/orders', () => {
    it('creates an order from cart items and clears cart', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });

      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery', quantity: 2 });

      const res = await request(app)
        .post('/api/orders')
        .send({
          sessionId: TEST_SESSION,
          customerName: 'Test Customer',
          customerEmail: 'test@example.com',
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.customer_name).toBe('Test Customer');
      expect(res.body.customer_email).toBe('test@example.com');
      expect(res.body.status).toBe('confirmed');
      expect(res.body.items).toHaveLength(2);

      // Wire-shape assertion: pin the response item field names so client/server drift
      // (e.g. title vs book_title) is caught at the unit-test layer.
      expect(res.body.items[0]).toMatchObject({
        book_id: expect.any(String),
        title: expect.any(String),
        quantity: expect.any(Number),
        price: expect.any(Number),
      });

      const expectedTotal = 19.99 + 17.99 * 2;
      expect(res.body.total).toBeCloseTo(expectedTotal, 2);

      const cartRes = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(cartRes.body.items).toHaveLength(0);
    });

    it('returns 400 when cart is empty', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({
          sessionId: TEST_SESSION,
          customerName: 'Test Customer',
          customerEmail: 'test@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cart is empty');
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({ sessionId: TEST_SESSION });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });
  });

  describe('checkout charges only for available books', () => {
    // The property under test in all four cases: the total GET /api/cart shows
    // and the total POST /api/orders charges are the same number. Before the
    // shared AVAILABLE_BOOK_WHERE filter they were computed from two different
    // row sets, so a cart holding an unavailable book displayed one total and
    // billed another.
    async function cartTotal(): Promise<number> {
      const res = await request(app).get(`/api/cart/${TEST_SESSION}`);
      return res.body.total;
    }

    function checkout() {
      return request(app)
        .post('/api/orders')
        .send({
          sessionId: TEST_SESSION,
          customerName: 'Test Customer',
          customerEmail: 'test@example.com',
        });
    }

    it('excludes a soft-deleted book from order items and total (regression)', async () => {
      // Fails against master: orders.ts read the cart with no relation filter,
      // so this order contained both books and charged 19.99 + 17.99.
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery', quantity: 1 });
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { deleted_at: new Date() },
      });

      const displayed = await cartTotal();
      const res = await checkout();

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].book_id).toBe('dinosaur-bakery');
      expect(res.body.total).toBeCloseTo(17.99, 2);
      expect(res.body.total).toBeCloseTo(displayed, 2);
    });

    it('excludes a withdrawn (draft) book from order items and total', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery', quantity: 1 });
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft' },
      });

      const displayed = await cartTotal();
      const res = await checkout();

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].book_id).toBe('dinosaur-bakery');
      expect(res.body.total).toBeCloseTo(17.99, 2);
      expect(res.body.total).toBeCloseTo(displayed, 2);
    });

    it('returns 400 Cart is empty when every item is unavailable', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery', quantity: 1 });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { status: 'draft' },
      });
      await prisma.book.update({
        where: { id: 'dinosaur-bakery' },
        data: { deleted_at: new Date() },
      });

      expect(await cartTotal()).toBe(0);

      const res = await checkout();

      // The existing empty-cart 400, not a new "everything went away" code.
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(res.body.error).toBe('Cart is empty');
    });

    it('charges the displayed total when every item is available', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery', quantity: 2 });

      const displayed = await cartTotal();
      const res = await checkout();

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBeCloseTo(displayed, 2);
    });
  });

  describe('GET /api/orders/:id', () => {
    it('returns order with items', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });

      const createRes = await request(app)
        .post('/api/orders')
        .send({
          sessionId: TEST_SESSION,
          customerName: 'Test Customer',
          customerEmail: 'test@example.com',
        });

      const orderId = createRes.body.id;

      const res = await request(app).get(`/api/orders/${orderId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(orderId);
      expect(res.body.customer_name).toBe('Test Customer');
      expect(res.body.customer_email).toBe('test@example.com');
      expect(res.body.status).toBe('confirmed');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].book_id).toBe('luna-star-garden');
      expect(res.body.items[0].quantity).toBe(1);
      expect(res.body.items[0].price).toBe(19.99);

      // Wire-shape assertion: pin the response item field names so client/server drift
      // (e.g. title vs book_title) is caught at the unit-test layer.
      expect(res.body.items[0]).toMatchObject({
        book_id: expect.any(String),
        title: expect.any(String),
        quantity: expect.any(Number),
        price: expect.any(Number),
      });
    });

    it('returns 404 for nonexistent order', async () => {
      const res = await request(app).get('/api/orders/nonexistent-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Order not found');
    });
  });
});
