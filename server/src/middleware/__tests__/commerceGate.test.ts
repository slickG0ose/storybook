import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDatabase } from '../../__tests__/setup';
import { commerceEnabled } from '../commerceGate';

// Uses the real cart/orders routers (the gate is mounted inside them), so a
// route added later without the gate in front would show up here only if it is
// added to the table below. Keep the table in step with routes/cart.ts + orders.ts.

const GATE_BODY = { error: expect.any(String), code: 'COMMERCE_DISABLED' };

const COMMERCE_ROUTES: Array<[string, 'get' | 'post' | 'put' | 'delete', string]> = [
  ['GET cart', 'get', '/api/cart/s1'],
  ['POST cart item', 'post', '/api/cart/s1/items'],
  ['PUT cart item', 'put', '/api/cart/s1/items/luna-star-garden'],
  ['DELETE cart item', 'delete', '/api/cart/s1/items/luna-star-garden'],
  ['DELETE cart', 'delete', '/api/cart/s1'],
  ['POST order', 'post', '/api/orders'],
  ['GET order', 'get', '/api/orders/some-id'],
];

describe('commerce kill switch (COMMERCE_ENABLED)', () => {
  const original = process.env.COMMERCE_ENABLED;
  let app: Express;

  beforeEach(async () => {
    await resetDatabase();
    app = createTestApp();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.COMMERCE_ENABLED;
    else process.env.COMMERCE_ENABLED = original;
  });

  describe('when off', () => {
    beforeEach(() => {
      process.env.COMMERCE_ENABLED = 'false';
    });

    it.each(COMMERCE_ROUTES)('%s returns 503 COMMERCE_DISABLED', async (_name, method, path) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject(GATE_BODY);
    });

    it('does not gate a non-commerce route', async () => {
      const res = await request(app).get('/api/books');
      expect(res.status).toBe(200);
    });
  });

  describe('when on', () => {
    it.each([
      ['unset', undefined],
      ['true', 'true'],
      ['blank', ''],
      ['malformed', 'banana'],
    ])('%s leaves cart and orders working', async (_label, value) => {
      if (value === undefined) delete process.env.COMMERCE_ENABLED;
      else process.env.COMMERCE_ENABLED = value;

      const cart = await request(app).get('/api/cart/s1');
      expect(cart.status).toBe(200);
      expect(cart.body).toMatchObject({ items: [], total: 0 });

      const order = await request(app).get('/api/orders/does-not-exist');
      expect(order.status).toBe(404);
    });
  });

  describe('commerceEnabled() parsing', () => {
    it.each(['false', 'FALSE', ' off ', '0', 'No'])('%j is off', (value) => {
      process.env.COMMERCE_ENABLED = value;
      expect(commerceEnabled()).toBe(false);
    });

    it.each(['true', '1', 'on', '', '  ', 'fasle'])('%j is on', (value) => {
      process.env.COMMERCE_ENABLED = value;
      expect(commerceEnabled()).toBe(true);
    });
  });
});
