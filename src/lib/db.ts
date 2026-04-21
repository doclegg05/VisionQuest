import { Prisma, PrismaClient } from "@prisma/client";
import { getRlsContext } from "./rls-context";

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
 * --- RLS STATUS (updated 2026-04-21, Phase 3 Slice A) ---
 * RLS is ENABLED on ALL tables:
 *   - Migration 20260403060000: RLS + vq_app policies on 29 student-data tables
 *   - Migration 20260415000000: RLS enabled on remaining 32 tables
 *   - Migration 20260421020000: vq_app role + managed_student_ids function
 *
 * The `prisma` export connects as `postgres` (superuser) which bypasses RLS.
 * Tenant isolation still relies on app-layer `where` clauses.
 *
 * When RLS_CONTEXT_INJECTION=true, every query wraps in a transaction that
 * calls `set_config('app.current_user_id', ..., true)` and friends. With
 * the current postgres connection this is a no-op at enforcement level
 * but verifies the plumbing end-to-end ahead of the Slice C connection-
 * role swap.
 *
 * `prismaAdmin` is identical to `prisma` but bypasses the RLS extension.
 * Use it from internal cron endpoints, background job handlers, and
 * admin operations that must see all rows.
 */
function applyPoolDefaults(): void {
  const poolSize = parseInt(process.env.DB_POOL_SIZE ?? "5", 10);
  const poolTimeout = parseInt(process.env.DB_POOL_TIMEOUT ?? "10", 10);

  const url = process.env.DATABASE_URL ?? "";
  const hasPoolParams = url.includes("connection_limit=") || url.includes("pool_timeout=");

  if (!hasPoolParams && url) {
    const separator = url.includes("?") ? "&" : "?";
    process.env.DATABASE_URL = `${url}${separator}connection_limit=${poolSize}&pool_timeout=${poolTimeout}`;
  }
}

applyPoolDefaults();

/**
 * Prisma extension that injects the RLS session context into every query.
 *
 * Implementation note: Prisma's extension `query` callback cannot inject
 * into the caller's transaction, but `$transaction([...])` batch mode runs
 * its elements in a single implicit transaction over one connection. We
 * rely on that to issue three `set_config(..., is_local=true)` calls
 * followed by the actual query, all within the same transaction scope.
 *
 * When no RLS context is present (e.g. during startup, migrations, or
 * unauthenticated requests), the query runs unwrapped — currently a no-op
 * because we connect as `postgres`. Once Slice C swaps to `vq_app`, the
 * absence of context will fail-closed (no rows visible) which is the
 * correct default for unauthenticated access paths.
 */
const rlsExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "rls-context",
    query: {
      $allOperations({ args, query }) {
        // Gated per-call so the flag can be toggled at runtime without
        // rebuilding the client. No context = unwrapped query (fail-closed
        // under vq_app once Slice C lands; currently a no-op under postgres).
        if (process.env.RLS_CONTEXT_INJECTION !== "true") return query(args);

        const ctx = getRlsContext();
        if (!ctx) return query(args);

        const { userId, role, studentId } = ctx;

        return (async () => {
          const results = await client.$transaction([
            client.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
            client.$executeRaw`SELECT set_config('app.current_role', ${role}, true)`,
            client.$executeRaw`SELECT set_config('app.current_student_id', ${studentId}, true)`,
            query(args),
          ]);
          return results[results.length - 1];
        })();
      },
    },
  }),
);

const globalForPrisma = globalThis as unknown as {
  prismaAdmin?: PrismaClient;
};

function buildAdminClient(): PrismaClient {
  return new PrismaClient();
}

const adminClient: PrismaClient = globalForPrisma.prismaAdmin ?? buildAdminClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaAdmin = adminClient;

/**
 * App-layer Prisma client. When RLS_CONTEXT_INJECTION=true AND an RLS
 * context is active (populated by withAuth), every query wraps in a
 * transaction that sets the `app.current_*` GUCs. Otherwise queries pass
 * through unwrapped.
 */
export const prisma = adminClient.$extends(rlsExtension);

/**
 * Admin Prisma client — same connection as `prisma` but never injects RLS
 * context. Use from cron endpoints, background job processors, and other
 * internal flows that must bypass policies.
 *
 * Until Slice C switches the app connection to `vq_app`, `prisma` and
 * `prismaAdmin` are functionally equivalent at the DB level (both run as
 * `postgres` which bypasses RLS). Callers should still use the right one
 * now so the eventual swap is a pure config change.
 */
export const prismaAdmin: PrismaClient = adminClient;
