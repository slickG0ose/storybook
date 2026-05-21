import { z } from 'zod';

// ---------------------------------------------------------------------------
// CartItem — wire shape returned inside the GET /api/cart/:sessionId response.
// Note: the server's legacy Store interface uses CartItemRow (a DB row shape).
// This type describes what the client actually receives over the wire.
// ---------------------------------------------------------------------------
export const CartItemSchema = z.object({
  id: z.number().int(),
  book_id: z.string(),
  quantity: z.number().int(),
  title: z.string(),
  price: z.number(),
  cover_emoji: z.string(),
  cover_color: z.string(),
  author: z.string(),
});
export type CartItem = z.infer<typeof CartItemSchema>;

// ---------------------------------------------------------------------------
// GET /api/cart/:sessionId — fetch cart for a session
// ---------------------------------------------------------------------------
export const CartGetResponseSchema = z.object({
  items: z.array(CartItemSchema),
  total: z.number(),
});
export type CartGetResponse = z.infer<typeof CartGetResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/cart/:sessionId/items — add a book to the cart
// ---------------------------------------------------------------------------
export const CartAddItemRequestSchema = z.object({
  bookId: z
    .string({ required_error: 'bookId is required' })
    .min(1, 'bookId is required'),
  quantity: z.number().int().positive().optional().default(1),
});
export type CartAddItemRequest = z.infer<typeof CartAddItemRequestSchema>;

export const CartAddItemResponseSchema = z.object({ success: z.boolean() });
export type CartAddItemResponse = z.infer<typeof CartAddItemResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/cart/:sessionId/items/:bookId — update quantity for a cart item
// ---------------------------------------------------------------------------
export const CartUpdateItemRequestSchema = z.object({
  quantity: z.number().int().min(0, 'quantity must be >= 0'),
});
export type CartUpdateItemRequest = z.infer<typeof CartUpdateItemRequestSchema>;

export const CartUpdateItemResponseSchema = z.object({ success: z.boolean() });
export type CartUpdateItemResponse = z.infer<typeof CartUpdateItemResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/cart/:sessionId/items/:bookId — remove a specific item
// ---------------------------------------------------------------------------
export const CartRemoveItemResponseSchema = z.object({ success: z.boolean() });
export type CartRemoveItemResponse = z.infer<typeof CartRemoveItemResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/cart/:sessionId — clear entire cart
// ---------------------------------------------------------------------------
export const CartClearResponseSchema = z.object({ success: z.boolean() });
export type CartClearResponse = z.infer<typeof CartClearResponseSchema>;
