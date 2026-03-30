import { PrismaClient } from "@prisma/client";

/**
 * Connection pool configuration.
 *
 * Prisma uses a connection pool internally. These env vars control the pool
 * size and timeout, which is important for Render/Supabase free tier limits.
 *
 * Set via environment:
 *   DB_POOL_SIZE=5       (default, Supabase free tier max: 50)
 *   DB_POOL_TIMEOUT=10   (seconds to wait for a pool slot)
 *
 * For multi-instance deployments, reduce pool size per instance:
 *   2 instances × 5 pool = 10 connections (well under Supabase 50 limit)
 */
function buildPrismaClient(): PrismaClient {
  const poolSize = parseInt(process.env.DB_POOL_SIZE ?? "5", 10);
  const poolTimeout = parseInt(process.env.DB_POOL_TIMEOUT ?? "10", 10);

  // Append connection pool params to DATABASE_URL if not already present
  const url = process.env.DATABASE_URL ?? "";
  const hasPoolParams = url.includes("connection_limit=") || url.includes("pool_timeout=");

  if (!hasPoolParams && url) {
    const separator = url.includes("?") ? "&" : "?";
    process.env.DATABASE_URL = `${url}${separator}connection_limit=${poolSize}&pool_timeout=${poolTimeout}`;
  }

  return new PrismaClient();
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || buildPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
