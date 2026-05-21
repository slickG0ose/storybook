import type { CartItem, Order, OrderItem } from '@storybook/shared';

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  token: string | null;
  created_at: string;
}

// CartItemRow is the DB row shape used internally in the legacy Store interface.
// The wire-shape CartItem (what clients receive) is sourced from @storybook/shared.
export interface CartItemRow {
  id: number;
  session_id: string;
  book_id: string;
  quantity: number;
}

// Book, Page, Character, CharacterRole, CartItem, Order, OrderItem are all sourced
// from @storybook/shared (Zod schemas). Do not redeclare them here — see
// shared/src/{books,cart,orders}.ts. Re-exported so existing in-server consumers
// can keep importing from '../types'.
export type {
  Book,
  BookVersion,
  BookWithPages,
  CartItem,
  Character,
  CharacterRole,
  IllustrationVersion,
  Order,
  OrderItem,
  Page,
} from '@storybook/shared';

// ---------------------------------------------------------------------------
// Legacy JSON-store shapes
//
// `Store` is the schema of the long-deprecated `data.json` file-store from
// before the Prisma migration. The runtime app doesn't read or write it
// anymore (test setup + production both use Prisma + resetDatabase), but the
// `getStore` / `resetStore` / `initDb` exports still compile, so we keep the
// types accurate.
//
// `LegacyBook` / `LegacyPage` are deliberately narrower than the wire-shape
// `Book` / `Page` Zod schemas — the JSON store only ever persisted these
// columns, and `is_featured` / `is_user_created` are 0/1 numbers, not booleans.
// Kept local to the server so the shared schemas describe today's wire shape
// without legacy-flag drag.
// ---------------------------------------------------------------------------
export interface LegacyBook {
  id: string;
  title: string;
  author: string;
  description: string;
  theme: string;
  age_range: string;
  cover_emoji: string;
  cover_color: string;
  price: number;
  is_featured: number;
  is_user_created: number;
  created_by: string | null;
  created_at: string;
}

export interface LegacyPage {
  id: number;
  book_id: string;
  page_number: number;
  text: string;
  illustration_description: string;
}

export interface Store {
  users: User[];
  books: LegacyBook[];
  pages: LegacyPage[];
  cartItems: CartItemRow[];
  orders: Order[];
  orderItems: OrderItem[];
}
