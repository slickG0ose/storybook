import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  OrderCreateRequestSchema,
  OrderCreateResponseSchema,
  OrderGetByIdResponseSchema,
  type OrderCreateRequest,
} from '@storybook/shared';
import prisma from '../db/prisma';
import { validate } from '../middleware/validate';

const router = Router();

router.post(
  '/',
  validate({
    name: 'POST /api/orders',
    request: OrderCreateRequestSchema,
    response: OrderCreateResponseSchema,
  }),
  async (req: Request, res: Response) => {
    // Body is already validated and typed by the middleware.
    const { sessionId, customerName, customerEmail } = req.body as OrderCreateRequest;

    const cartItems = await prisma.cartItem.findMany({
      where: { session_id: sessionId },
      include: { book: true },
    });

    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const total = cartItems.reduce((sum, item) => sum + item.book.price * item.quantity, 0);

    const order = await prisma.order.create({
      data: {
        session_id: sessionId,
        customer_name: customerName,
        customer_email: customerEmail,
        total,
        items: {
          create: cartItems.map(item => ({
            book_id: item.book_id,
            title: item.book.title,
            quantity: item.quantity,
            price: item.book.price,
          })),
        },
      },
      include: { items: true },
    });

    await prisma.cartItem.deleteMany({ where: { session_id: sessionId } });

    res.json(order);
  },
);

router.get(
  '/:id',
  validate({
    name: 'GET /api/orders/:id',
    response: OrderGetByIdResponseSchema,
  }),
  async (req: Request<{ id: string }>, res: Response) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  },
);

export default router;
