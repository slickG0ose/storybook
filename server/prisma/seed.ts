import { PrismaClient } from '@prisma/client';
import { seedCanonicalBooks } from '../src/seed/canonicalBooks';

const prisma = new PrismaClient();

async function main() {
  const { books } = await seedCanonicalBooks(prisma);
  console.log(`Seeded ${books} books with pages`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
