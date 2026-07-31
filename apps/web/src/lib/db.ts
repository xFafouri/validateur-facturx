import { PrismaClient } from '@prisma/client';

/**
 * Prisma client, lazily created.
 *
 * Lazy because Phase 0's core value - the validator - has no database dependency at all. Making
 * the client eager would mean an unconfigured or unreachable database took down the validator
 * itself, which is exactly backwards: the free validator is the thing that must stay up.
 *
 * In development, the instance is cached on `globalThis` so hot reload does not open a new
 * connection pool on every edit.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function isDatabaseConfigured(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim() !== '';
}

export function getPrisma(): PrismaClient {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is not configured.');
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalForPrisma.prisma;
}
