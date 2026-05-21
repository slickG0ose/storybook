import { z } from 'zod';

// ---------------------------------------------------------------------------
// Order item (line item on a created order)
// ---------------------------------------------------------------------------
// Wire-shape note: the OrderConfirmation drift bug was here — server returned
// `book_title` while the client expected `title`. The field is now `title` on
// both sides, and this schema is the single source of truth that fails loudly
// if anyone reintroduces the divergence.
export const OrderItemSchema = z.object({
  id: z.number().int(),
  order_id: z.string(),
  book_id: z.string(),
  title: z.string(),
  quantity: z.number().int(),
  price: z.number(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

// ---------------------------------------------------------------------------
// Order (response shape — Prisma serializes Date -> ISO string over JSON)
// ---------------------------------------------------------------------------
export const OrderSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  user_id: z.string().nullable(),
  customer_name: z.string(),
  customer_email: z.string(),
  total: z.number(),
  status: z.string(),
  created_at: z.string(),
  items: z.array(OrderItemSchema),
});
export type Order = z.infer<typeof OrderSchema>;

// ---------------------------------------------------------------------------
// POST /api/orders — create order from current cart
// ---------------------------------------------------------------------------
export const OrderCreateRequestSchema = z.object({
  sessionId: z.string({ required_error: 'sessionId is required' }).min(1, 'sessionId is required'),
  customerName: z
    .string({ required_error: 'customerName is required' })
    .min(1, 'customerName is required'),
  customerEmail: z
    .string({ required_error: 'customerEmail is required' })
    .min(1, 'customerEmail is required'),
});
export type OrderCreateRequest = z.infer<typeof OrderCreateRequestSchema>;

export const OrderCreateResponseSchema = OrderSchema;
export type OrderCreateResponse = z.infer<typeof OrderCreateResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------
export const OrderGetByIdResponseSchema = OrderSchema;
export type OrderGetByIdResponse = z.infer<typeof OrderGetByIdResponseSchema>;

// ---------------------------------------------------------------------------
// Shared error response shape (returned by validate() and route handlers)
// ---------------------------------------------------------------------------
export const ErrorResponseSchema = z.object({
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
