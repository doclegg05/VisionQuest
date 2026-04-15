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
 *
 * --- RLS STATUS (updated 2026-04-15) ---
 * RLS is ENABLED on ALL tables:
 *   - Migration 20260403060000: RLS + vq_app policies on 29 student-data tables
 *   - Migration 20260415000000: RLS enabled on remaining 32 tables (no policies
 *     needed — enabled RLS with no matching policy = deny all for non-superusers)
 *
 * This client connects as `postgres` (superuser) which bypasses RLS entirely.
 * Tenant isolation relies on app-layer `where` clauses (studentId ownership
 * checks in every query). The Supabase PostgREST API (anon/authenticated roles)
 * is now fully blocked by RLS on every table.
 *
 * TODO (defense-in-depth): Create a restricted `vq_app` DB role, add a Prisma
 * client extension to SET LOCAL GUCs per request, and connect as vq_app.
 * See: docs/plans/supabase-optimization.md
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
