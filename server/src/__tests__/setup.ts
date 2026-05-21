import express from 'express';
import prisma from '../db/prisma';
import authRouter from '../routes/auth';
import booksRouter from '../routes/books';
import cartRouter from '../routes/cart';
import ordersRouter from '../routes/orders';
import adminRouter from '../routes/admin';

const seedBooks = [
  { id: 'luna-star-garden', title: 'Luna and the Star Garden', author: 'AI Storybook', description: 'A story about stars.', theme: 'fantasy', age_range: '4-7', cover_emoji: '\u{1F31F}', cover_color: '#7c3aed', price: 19.99, is_featured: true, is_user_created: false },
  { id: 'captain-bear-submarine', title: "Captain Bear's Submarine Surprise", author: 'AI Storybook', description: 'An underwater adventure.', theme: 'adventure', age_range: '3-6', cover_emoji: '\u{1F43B}', cover_color: '#0891b2', price: 18.99, is_featured: true, is_user_created: false },
  { id: 'robot-learns-to-hug', title: 'The Robot Who Learned to Hug', author: 'AI Storybook', description: 'A story about feelings.', theme: 'friendship', age_range: '4-8', cover_emoji: '\u{1F916}', cover_color: '#dc2626', price: 19.99, is_featured: true, is_user_created: false },
  { id: 'dinosaur-bakery', title: 'The Dinosaur Bakery', author: 'AI Storybook', description: 'A funny baking story.', theme: 'humor', age_range: '3-6', cover_emoji: '\u{1F996}', cover_color: '#16a34a', price: 17.99, is_featured: false, is_user_created: false },
  { id: 'cloud-painter', title: 'Zara the Cloud Painter', author: 'AI Storybook', description: 'A creative story.', theme: 'imagination', age_range: '5-9', cover_emoji: '\u{1F3A8}', cover_color: '#f59e0b', price: 21.99, is_featured: false, is_user_created: false },
  { id: 'brave-little-seed', title: 'The Brave Little Seed', author: 'AI Storybook', description: 'A story about growth.', theme: 'nature', age_range: '2-5', cover_emoji: '\u{1F331}', cover_color: '#65a30d', price: 16.99, is_featured: false, is_user_created: false },
];

const seedPages = [
  { book_id: 'luna-star-garden', page_number: 1, text: 'Page 1 text', illustration_description: 'Illustration 1' },
  { book_id: 'luna-star-garden', page_number: 2, text: 'Page 2 text', illustration_description: 'Illustration 2' },
  { book_id: 'luna-star-garden', page_number: 3, text: 'Page 3 text', illustration_description: 'Illustration 3' },
  { book_id: 'luna-star-garden', page_number: 4, text: 'Page 4 text', illustration_description: 'Illustration 4' },
  { book_id: 'luna-star-garden', page_number: 5, text: 'Page 5 text', illustration_description: 'Illustration 5' },
];

// resetDatabase: wipes every table, then re-seeds 6 books + 5 luna-star-garden
// pages. Verified for OPS.2: deleteMany clears any rows that prior tests soft-
// deleted, and the re-seed inserts fresh rows so seeded books always have
// deleted_at = null (Prisma default). No seeded users, so role/deleted_at on
// User are tested via per-test /register calls which inherit the schema
// defaults (role='user', deleted_at=null).
export async function resetDatabase() {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.bookVersion.deleteMany();
  await prisma.illustrationVersion.deleteMany();
  await prisma.page.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();

  for (const book of seedBooks) {
    await prisma.book.upsert({
      where: { id: book.id },
      update: {},
      create: book,
    });
  }
  for (const page of seedPages) {
    await prisma.page.upsert({
      where: { book_id_page_number: { book_id: page.book_id, page_number: page.page_number } },
      update: {},
      create: page,
    });
  }
}

export function createTestApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.use('/api/auth', authRouter);
  app.use('/api/books', booksRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminRouter);

  return app;
}
