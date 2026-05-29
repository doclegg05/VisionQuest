import { Prisma, PrismaClient } from "@prisma/client";
import { getRlsContext, type RlsContext } from "./rls-context";
import { rlsContextFromHeaders } from "./rls-headers";
import { logger } from "./logger";

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
 * --- RLS STATUS (Slice C LIVE in prod; verified 2026-05-29) ---
 * RLS is ENABLED on ALL tables and ENFORCED in production:
 *   - Migration 20260403060000: RLS + vq_app policies on 29 student-data tables
 *   - Migration 20260415000000: RLS enabled on remaining 32 tables
 *   - Migration 20260421020000: vq_app role + managed_student_ids function
 *   - Migration 20260423120000/130000/140000: policy recovery + recursion fix
 *
 * In production `DATABASE_URL` points at the restricted `vq_app` role and
 * `RLS_CONTEXT_INJECTION=true` (both set in the Render dashboard, so they
 * are NOT visible in render.yaml). Verified 2026-05-29: as `vq_app` with no
 * session context, `SELECT count(*) FROM "Student"` returns 0 — policies
 * fail closed. Tenant isolation is enforced by the DB, not just app-layer
 * `where` clauses.
 *
 * When RLS_CONTEXT_INJECTION=true, every query wraps in a transaction that
 * calls `set_config('app.current_user_id', ..., true)` and friends so the
 * policies can see who is asking. A query with no context returns zero rows
 * (fail-closed) — a silent "empty page" in prod usually means a code path
 * touched `prisma` outside `withAuth` / server-component header context.
 *
 * `prismaAdmin` uses ADMIN_DATABASE_URL (the `postgres` role) and bypasses
 * RLS. Use it ONLY from internal cron endpoints, background job handlers,
 * pre-auth/public routes, and admin operations that must see all rows.
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
async function tryLoadContextFromHeaders(): Promise<RlsContext | null> {
  // `next/headers` throws when called outside a request scope (scripts,
  // migrations, tests). Treat any failure as "no context" and let the
  // caller fall through to an unwrapped query.
  try {
    const { headers } = await import("next/headers");
    const store = await headers();
    return rlsContextFromHeaders(store);
  } catch {
    return null;
  }
}

/**
 * Signal when a Prisma query runs with no RLS context. Under `vq_app`
 * this path returns silently filtered results (rows that don't match
 * the ever-empty GUC predicates) — the same class of bug as the Library
 * 404s we chased on 2026-04-24.
 *
 * Three modes, chosen in order:
 *   - Production: silent. Legitimate anonymous paths would otherwise
 *     spam logs.
 *   - `RLS_CONTEXT_STRICT=true`: throw an Error. Intended for CI and
 *     any environment that wants hard enforcement. A caught exception
 *     is infinitely louder than a swallowed empty-result set.
 *   - Otherwise: `logger.warn`. Dev default; the noise is the feature.
 *
 * `DISABLE_RLS_CONTEXT_WARN=true` silences warn mode for scripts and
 * one-off migrations that legitimately bypass ALS.
 */
function warnMissingRlsContext(model: string | undefined, operation: string): void {
  if (process.env.NODE_ENV === "production") return;
  const modelLabel = model ?? "(unknown)";
  const hint =
    "API routes should use withAuth/withTeacherAuth (not withErrorHandler + getSession). Server components need the proxy to attach session headers (/api/* and /app routes).";
  if (process.env.RLS_CONTEXT_STRICT === "true") {
    throw new Error(
      `prisma.${modelLabel}.${operation} ran with no RLS context. ${hint}`,
    );
  }
  if (process.env.DISABLE_RLS_CONTEXT_WARN === "true") return;
  logger.warn("prisma query ran with no RLS context", {
    model: modelLabel,
    operation,
    hint,
  });
}

function runWithContext(
  client: PrismaClient,
  ctx: RlsContext,
  args: unknown,
  query: (args: unknown) => Promise<unknown>,
): Promise<unknown> {
  const { userId, role, studentId } = ctx;
  return (async () => {
    // Combine the three set_config calls into a single SELECT so the
    // transaction round-trips only twice (set_configs + query) instead of
    // four times. `is_local=true` requires a transaction, which
    // $transaction([...]) provides. Every set_config(text, text, boolean)
    // is independent — calling them as a comma-separated SELECT list runs
    // them all in one statement.
    const results = await client.$transaction([
      client.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true), set_config('app.current_role', ${role}, true), set_config('app.current_student_id', ${studentId}, true)`,
      query(args) as unknown as Prisma.PrismaPromise<unknown>,
    ]);
    return results[results.length - 1];
  })();
}

const rlsExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "rls-context",
    query: {
      $allOperations({ args, query, operation, model }) {
        // Gated per-call so the flag can be toggled at runtime without
        // rebuilding the client. No context = unwrapped query (fail-closed
        // under vq_app once Slice C lands; currently a no-op under postgres).
        if (process.env.RLS_CONTEXT_INJECTION !== "true") return query(args);

        // Fast path: API routes go through `withAuth`, which seeds ALS via
        // `withRlsContext` before ever touching Prisma. No extra awaits.
        const alsCtx = getRlsContext();
        if (alsCtx) {
          return runWithContext(
            client as unknown as PrismaClient,
            alsCtx,
            args,
            query as (args: unknown) => Promise<unknown>,
          );
        }

        // Slow path (Slice B): server components that never hit `withAuth`.
        // The middleware (src/proxy.ts) decoded the session JWT and set
        // `x-vq-*` request headers; we hydrate context from them here.
        return (async () => {
          const headerCtx = await tryLoadContextFromHeaders();
          if (!headerCtx) {
            // Neither ALS nor request headers produced an RLS context. Under
            // `vq_app` this means the query runs with empty GUCs — RLS
            // policies that key off the session silently reject every row.
            // Legitimate cases: migrations, one-off scripts, anonymous
            // pre-login requests. Illegitimate case: an API route using
            // `withErrorHandler` + manual `getSession()` instead of
            // `withAuth` (see fix(rls) commit 0cb9876). Log a dev-only
            // warning with the model + operation so the footgun surfaces
            // immediately next time.
            warnMissingRlsContext(model, operation);
            return query(args);
          }
          return runWithContext(
            client as unknown as PrismaClient,
            headerCtx,
            args,
            query as (args: unknown) => Promise<unknown>,
          );
        })();
      },
    },
  }),
);

const globalForPrisma = globalThis as unknown as {
  prismaApp?: PrismaClient;
  prismaAdmin?: PrismaClient;
};

function buildAppClient(): PrismaClient {
  return new PrismaClient();
}

/**
 * The admin client deliberately uses a separate PrismaClient bound to
 * ADMIN_DATABASE_URL when set (Slice C — points at the unrestricted
 * `postgres` role). It falls back to DATABASE_URL for envs where the
 * swap hasn't happened yet, in which case both clients hit the same
 * connection and behave identically at the DB level.
 */
function buildAdminClient(): PrismaClient {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (adminUrl && adminUrl !== process.env.DATABASE_URL) {
    return new PrismaClient({ datasources: { db: { url: adminUrl } } });
  }
  return new PrismaClient();
}

const appClient: PrismaClient = globalForPrisma.prismaApp ?? buildAppClient();
const adminClient: PrismaClient = globalForPrisma.prismaAdmin ?? buildAdminClient();
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaApp = appClient;
  globalForPrisma.prismaAdmin = adminClient;
}

/**
 * App-layer Prisma client. When RLS_CONTEXT_INJECTION=true AND an RLS
 * context is active (populated by withAuth), every query wraps in a
 * transaction that sets the `app.current_*` GUCs. Otherwise queries pass
 * through unwrapped.
 *
 * After Slice C, DATABASE_URL points at the `vq_app` role (no RLS
 * bypass); un-contextualized queries fail-closed.
 */
export const prisma = appClient.$extends(rlsExtension);

/**
 * Admin Prisma client — uses ADMIN_DATABASE_URL (postgres credentials)
 * after Slice C. Never injects RLS context. Use from pre-auth routes
 * (login, register, password reset), cron endpoints, public pages, and
 * internal flows that must bypass policies.
 *
 * Before Slice C (ADMIN_DATABASE_URL unset), this falls back to the
 * same DATABASE_URL as `prisma`, so callers get identical behavior
 * today and the eventual swap is a pure env-var change.
 */
export const prismaAdmin: PrismaClient = adminClient;
