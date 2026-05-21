import { Router } from 'express';
import prisma from '../db/prisma';
import type { Request, Response } from 'express';
import {
  CartAddItemRequestSchema,
  CartAddItemResponseSchema,
  CartGetResponseSchema,
  CartUpdateItemRequestSchema,
  CartUpdateItemResponseSchema,
  CartRemoveItemResponseSchema,
  CartClearResponseSchema,
  type CartAddItemRequest,
  type CartUpdateItemRequest,
} from '@storybook/shared';
import { validate } from '../middleware/validate';

const router = Router();

router.get(
  '/:sessionId',
  validate({
    name: 'GET /api/cart/:sessionId',
    response: CartGetResponseSchema,
  }),
  async (req: Request<{ sessionId: string }>, res: Response) => {
    const { sessionId } = req.params;
    // Filter out cart items whose book has been soft-deleted. Silent-hide UX:
    // the item simply disappears from the cart on next fetch. No banner, no 4xx.
    // Prisma relation filter executes in a single round-trip and the response
    // stays schema-valid (drift catch-net would fire if a null book leaked
    // through the join).
    const items = await prisma.cartItem.findMany({
      where: { session_id: sessionId, book: { deleted_at: null } },
      include: { book: true },
    });

    const mapped = items.map(item => ({
      id: item.id,
      book_id: item.book_id,
      quantity: item.quantity,
      title: item.book.title,
      price: item.book.price,
      cover_emoji: item.book.cover_emoji,
      cover_color: item.book.cover_color,
      author: item.book.author,
    }));

    const total = mapped.reduce((sum, item) => sum + item.price * item.quantity, 0);
    res.json({ items: mapped, total });
  },
);

router.post(
  '/:sessionId/items',
  validate({
    name: 'POST /api/cart/:sessionId/items',
    request: CartAddItemRequestSchema,
    response: CartAddItemResponseSchema,
  }),
  async (req: Request<{ sessionId: string }>, res: Response) => {
    const { bookId, quantity } = req.body as CartAddItemRequest;
    const { sessionId } = req.params;

    // findFirst with deleted_at: null so a soft-deleted book behaves identically
    // to a missing one — same 404, no information leak about tombstoned rows.
    const book = await prisma.book.findFirst({ where: { id: bookId, deleted_at: null } });
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const existing = await prisma.cartItem.findUnique({
      where: { session_id_book_id: { session_id: sessionId, book_id: bookId } },
    });

    if (existing) {
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
      });
    } else {
      await prisma.cartItem.create({
        data: { session_id: sessionId, book_id: bookId, quantity },
      });
    }

    res.json({ success: true });
  },
);

router.put(
  '/:sessionId/items/:bookId',
  validate({
    name: 'PUT /api/cart/:sessionId/items/:bookId',
    request: CartUpdateItemRequestSchema,
    response: CartUpdateItemResponseSchema,
  }),
  async (req: Request<{ sessionId: string; bookId: string }>, res: Response) => {
    const { quantity } = req.body as CartUpdateItemRequest;
    const { sessionId, bookId } = req.params;

    if (quantity <= 0) {
      await prisma.cartItem.deleteMany({
        where: { session_id: sessionId, book_id: bookId },
      });
    } else {
      const item = await prisma.cartItem.findUnique({
        where: { session_id_book_id: { session_id: sessionId, book_id: bookId } },
      });
      if (item) {
        await prisma.cartItem.update({
          where: { id: item.id },
          data: { quantity },
        });
      }
    }

    res.json({ success: true });
  },
);

router.delete(
  '/:sessionId/items/:bookId',
  validate({
    name: 'DELETE /api/cart/:sessionId/items/:bookId',
    response: CartRemoveItemResponseSchema,
  }),
  async (req: Request<{ sessionId: string; bookId: string }>, res: Response) => {
    const { sessionId, bookId } = req.params;
    await prisma.cartItem.deleteMany({
      where: { session_id: sessionId, book_id: bookId },
    });
    res.json({ success: true });
  },
);

router.delete(
  '/:sessionId',
  validate({
    name: 'DELETE /api/cart/:sessionId',
    response: CartClearResponseSchema,
  }),
  async (req: Request<{ sessionId: string }>, res: Response) => {
    const { sessionId } = req.params;
    await prisma.cartItem.deleteMany({
      where: { session_id: sessionId },
    });
    res.json({ success: true });
  },
);

export default router;
