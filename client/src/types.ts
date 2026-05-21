export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  token: string;
  role: UserRole;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  deleted_at: string | null;
  created_at: string;
}

// Character, Book, BookWithPages, OrphanIllustration, Page, IllustrationVersion,
// and BookVersion are sourced from @storybook/shared (Zod schemas).
// Do not redeclare them here — see shared/src/books.ts and shared/src/admin.ts.
// Re-exported so existing in-client consumers can keep importing from '../types'.
export type { Character, CharacterRole } from '@storybook/shared';
export type { Book } from '@storybook/shared';
export type { BookWithPages } from '@storybook/shared';
export type { OrphanIllustration } from '@storybook/shared';
export type { Page } from '@storybook/shared';

import type { Book } from '@storybook/shared';

// AdminBook keeps the local `extends Book` shape (option B from the migration
// plan): the shared `Book` is now the source of truth, and we add the admin
// list's `creator` join + retain `deleted_at` as a non-null contract here.
// AdminBookListItem in shared has the same fields; this local alias preserves
// the existing `AdminBook` symbol and leaves room for client-only admin fields.
export interface AdminBook extends Book {
  deleted_at: string | null;
  creator: { email: string; name: string } | null;
}

// CartItem, Order, and OrderItem are sourced from @storybook/shared (Zod schemas).
// Do not redeclare them here — see shared/src/cart.ts and shared/src/orders.ts.
// Re-exported so existing in-client consumers can keep importing from '../types'.
// `OrderSummary` was historically a near-duplicate of the wire `Order` shape; it
// has been retired in favor of `Order` itself (single source of truth for the
// wire shape). Consumers can ignore fields they don't render (e.g. session_id).
export type { CartItem } from '@storybook/shared';
export type { Order, OrderItem } from '@storybook/shared';

export type { IllustrationVersion } from '@storybook/shared';
export type { BookVersion } from '@storybook/shared';
