#!/usr/bin/env node

/**
 * Read-only health check for the scheduled layer: the seven Supabase pg_cron
 * jobs and the BackgroundJob queue they drain.
 *
 * Reports, per expected job: present in cron.job, active, schedule, and the
 * most recent cron.job_run_details row (status, start_time, return_message).
 * Then the HTTP outcomes in net._http_response for the last 6 hours (pg_net's
 * default ttl): a cron run is recorded succeeded whether the app answered
 * 200, 401, 404, or 500, because net.http_post/http_get are asynchronous, so
 * this is the only place a wrong CRON_SECRET or an app error shows. Then
 * BackgroundJob counts by status and the oldest pending createdAt.
 * Aggregate output only — no payloads, no URLs, no student identifiers.
 *
 * Connection: CRON_CHECK_DATABASE_URL, falling back to DATABASE_URL. It must
 * be the postgres-role connection string: pg_cron shows cron.job rows only to
 * the role that scheduled them (postgres, via prisma migrate deploy), and
 * BackgroundJob is RLS-protected (policy background_job_admin_only), so the
 * vq_app role sees nothing and the report would read as "everything missing".
 *
 * Exit codes:
 *   0  every expected job is present, active, has run, and last succeeded,
 *      and every net._http_response row in the window is a 200
 *   1  at least one job is missing, inactive, never ran, or last failed, or
 *      a response in the window was non-200, errored, or timed out
 *   2  the check did not run: no connection string, or the queries failed
 *      (an absent or unreadable net._http_response is reported, not fatal)
 *
 * Usage:
 *   npm run cron:health
 *   CRON_CHECK_DATABASE_URL='postgresql://postgres:...' npm run cron:health
 *
 * Verdict logic lives in scripts/lib/cron-health.mjs (tested in
 * src/lib/cron-health.test.ts). Background: docs/plans/pg-cron-setup-runbook.md.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { loadEnvFile } from "./lib/sage-rag-utils.mjs";
import {
  EXPECTED_CRON_JOBS,
  HTTP_RESPONSE_WINDOW_HOURS,
  evaluateCronHealth,
  formatCronHealthReport,
} from "./lib/cron-health.mjs";

const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_NOT_RUN = 2;

loadEnvFile();

export function resolveConnectionUrl(env) {
  const url = env.CRON_CHECK_DATABASE_URL || env.DATABASE_URL || "";
  return url.trim() || null;
}

/** Host and database only — never the credentials. */
function describeConnection(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "(socket)",
      database: parsed.pathname.replace(/^\//, "") || "(default)",
    };
  } catch {
    return { host: "(unparseable url)", database: "(unknown)" };
  }
}

/**
 * One line from a Prisma error: the Postgres message when there is one,
 * otherwise the first line after Prisma's "Invalid ... invocation" banner.
 * Never the connection string.
 */
function describeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const pgMessage = message.match(/Message: `([^`]*)`/);
  if (pgMessage) return pgMessage[1];
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Invalid `prisma/.test(line));
  return lines[0] ?? message;
}

async function fetchRole(prisma) {
  const rows = await prisma.$queryRaw(Prisma.sql`SELECT current_user::text AS role`);
  return rows[0]?.role ?? "(unknown)";
}

async function fetchCronJobs(prisma, names) {
  return prisma.$queryRaw(Prisma.sql`
    SELECT jobname, schedule, active
    FROM cron.job
    WHERE jobname IN (${Prisma.join(names)})
  `);
}

async function fetchLatestRuns(prisma, names) {
  return prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT ON (j.jobname)
           j.jobname, d.status, d.start_time, d.return_message
    FROM cron.job j
    JOIN cron.job_run_details d ON d.jobid = j.jobid
    WHERE j.jobname IN (${Prisma.join(names)})
    ORDER BY j.jobname, d.start_time DESC
  `);
}

/**
 * pg_net keeps a row per HTTP response for its ttl (default 6 hours), so the
 * window is the whole table in practice; LIMIT 500 is a safety cap (seven
 * jobs produce about fifty responses per window). Absent or unreadable table
 * (no pg_net, no grant): reported, never fatal.
 */
async function fetchHttpResponses(prisma) {
  try {
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT id, status_code, error_msg, timed_out, created
      FROM net._http_response
      WHERE created > now() - make_interval(hours => ${HTTP_RESPONSE_WINDOW_HOURS}::int)
      ORDER BY created DESC
      LIMIT 500
    `);
    return { available: true, windowHours: HTTP_RESPONSE_WINDOW_HOURS, rows };
  } catch (error) {
    return { available: false, reason: describeError(error) };
  }
}

async function fetchBackgroundJobs(prisma) {
  const groups = await prisma.backgroundJob.groupBy({
    by: ["status"],
    _count: { _all: true },
    orderBy: { status: "asc" },
  });
  const oldestPending = await prisma.backgroundJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return {
    countsByStatus: groups.map((group) => ({ status: group.status, count: group._count._all })),
    oldestPendingCreatedAt: oldestPending?.createdAt ?? null,
  };
}

/**
 * Importable core: runs the same queries and verdict logic as the CLI, for a
 * given postgres-role connection string, and returns the structured result
 * (no printing, no process.exit). Used by the CLI below and by
 * scripts/bench/suites/cron-health.mjs so the benchmark suite measures the
 * exact same evaluateCronHealth() verdict rather than a second copy of it.
 *
 * Throws on a query failure (missing table, wrong role, bad connection
 * string) — callers decide how to report that; the CLI below maps it to
 * EXIT_NOT_RUN, as it always has.
 *
 * @param {string} url postgres-role connection string
 * @returns {Promise<{ evaluation: ReturnType<typeof evaluateCronHealth>, backgroundJobs: object, connection: { host: string, database: string, role: string } }>}
 */
export async function runCronHealthCheck(url) {
  const names = [...EXPECTED_CRON_JOBS];
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const role = await fetchRole(prisma);
    const [jobs, latestRuns, backgroundJobs, httpResponses] = await Promise.all([
      fetchCronJobs(prisma, names),
      fetchLatestRuns(prisma, names),
      fetchBackgroundJobs(prisma),
      fetchHttpResponses(prisma),
    ]);

    const evaluation = evaluateCronHealth({ jobs, latestRuns, httpResponses });
    return { evaluation, backgroundJobs, connection: { ...describeConnection(url), role } };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const url = resolveConnectionUrl(process.env);
  if (!url) {
    console.error(
      "cron-health-check did not run: set CRON_CHECK_DATABASE_URL (or DATABASE_URL) to the postgres-role connection string."
    );
    return EXIT_NOT_RUN;
  }

  try {
    const { evaluation, backgroundJobs, connection } = await runCronHealthCheck(url);
    const lines = formatCronHealthReport({
      evaluation,
      backgroundJobs,
      connection,
      generatedAt: new Date().toISOString(),
    });
    for (const line of lines) console.log(line);

    if (connection.role !== "postgres") {
      console.log(
        `note: connected as ${connection.role}, not postgres; cron.job rows are visible only to the scheduling role and BackgroundJob is RLS-protected, so a MISSING/empty report may be a role problem.`
      );
    }

    return evaluation.ok ? EXIT_OK : EXIT_PROBLEMS;
  } catch (error) {
    console.error(`cron-health-check did not run: ${describeError(error)}`);
    return EXIT_NOT_RUN;
  }
}

// Only auto-run when executed directly — importing this module for
// runCronHealthCheck() (contract tests, the benchmark suite) must never
// start a live CLI run or call process.exit.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  });
}
