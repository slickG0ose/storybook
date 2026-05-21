import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase } from '../../__tests__/setup';
import prisma from '../../db/prisma';

const TEST_SESSION = 'test-session-123';

describe('Cart API routes', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  describe('POST /api/cart/:sessionId/items', () => {
    it('adds an item to the cart', async () => {
      const res = await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for invalid bookId', async () => {
      const res = await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'nonexistent-book' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Book not found');
    });

    it('returns 400 when bookId is missing', async () => {
      const res = await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request body: bookId: bookId is required');
    });

    it('increments quantity when adding same book again', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });

      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 2 });

      const res = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(3);
    });
  });

  describe('GET /api/cart/:sessionId', () => {
    it('returns empty cart for new session', async () => {
      const res = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('returns cart with items and total', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });

      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery', quantity: 2 });

      const res = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);

      const expectedTotal = 19.99 + 17.99 * 2;
      expect(res.body.total).toBeCloseTo(expectedTotal, 2);
    });

    it('cart items include book details', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden' });

      const res = await request(app).get(`/api/cart/${TEST_SESSION}`);
      const item = res.body.items[0];
      expect(item.book_id).toBe('luna-star-garden');
      expect(item.title).toBe('Luna and the Star Garden');
      expect(item.price).toBe(19.99);
      expect(item.quantity).toBe(1);
    });
  });

  describe('PUT /api/cart/:sessionId/items/:bookId', () => {
    it('updates item quantity', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden' });

      const res = await request(app)
        .put(`/api/cart/${TEST_SESSION}/items/luna-star-garden`)
        .send({ quantity: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const cartRes = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(cartRes.body.items[0].quantity).toBe(5);
    });

    it('removes item when quantity is set to 0', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden' });

      await request(app)
        .put(`/api/cart/${TEST_SESSION}/items/luna-star-garden`)
        .send({ quantity: 0 });

      const cartRes = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(cartRes.body.items).toHaveLength(0);
    });
  });

  describe('soft-deleted book filtering (silent hide)', () => {
    it('does not include soft-deleted books in cart hydration', async () => {
      // Two items in the cart, one of which points at a book that gets
      // soft-deleted after the cart is built. The GET response should silently
      // omit the affected item — no banner, no 4xx.
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden', quantity: 1 });
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery', quantity: 2 });

      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { deleted_at: new Date() },
      });

      const res = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].book_id).toBe('dinosaur-bakery');
      expect(res.body.total).toBeCloseTo(17.99 * 2, 2);
    });

    it('refuses to add a soft-deleted book to the cart', async () => {
      await prisma.book.update({
        where: { id: 'luna-star-garden' },
        data: { deleted_at: new Date() },
      });

      const res = await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden' });

      // Soft-deleted books behave identically to missing books — same 404,
      // same error message. No information leak about tombstoned rows.
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Book not found');
    });
  });

  describe('DELETE /api/cart/:sessionId/items/:bookId', () => {
    it('removes a specific item from the cart', async () => {
      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'luna-star-garden' });

      await request(app)
        .post(`/api/cart/${TEST_SESSION}/items`)
        .send({ bookId: 'dinosaur-bakery' });

      const res = await request(app)
        .delete(`/api/cart/${TEST_SESSION}/items/luna-star-garden`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const cartRes = await request(app).get(`/api/cart/${TEST_SESSION}`);
      expect(cartRes.body.items).toHaveLength(1);
      expect(cartRes.body.items[0].book_id).toBe('dinosaur-bakery');
    });
  });
});
