import { PrismaClient } from '@prisma/client';

// Supabase free tier allows only ~15 total connections.
// Limiting pool to 3 ensures we never saturate it even with concurrent chains.
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  log: ['error'],
});
export default prisma;
