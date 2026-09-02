#!/usr/bin/env node

/**
 * Read-only health check for the scheduled layer: the seven Supabase pg_cron
 * jobs and the BackgroundJob queue they drain.
 *
 * Reports, per expected job: present in cron.job, active, schedule, and the
 * most recent cron.job_run_details row (status, start_time, return_message).
 * Then BackgroundJob counts by status and the oldest pending createdAt.
 * Aggregate output only — no payloads, no student identifiers.
 *
 * Connection: CRON_CHECK_DATABASE_URL, falling back to DATABASE_URL. It must
 * be the postgres-role connection string: pg_cron shows cron.job rows only to
 * the role that scheduled them (postgres, via prisma migrate deploy), and
 * BackgroundJob is RLS-protected (policy background_job_admin_only), so the
 * vq_app role sees nothing and the report would read as "everything missing".
 *
 * Exit codes:
 *   0  every expected job is present, active, has run, and last succeeded
 *   1  at least one job is missing, inactive, never ran, or last failed
 *   2  the check did not run: no connection string, or the queries failed
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
import { EXPECTED_CRON_JOBS, evaluateCronHealth, formatCronHealthReport } from "./lib/cron-health.mjs";

const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_NOT_RUN = 2;

loadEnvFile();

function resolveConnectionUrl(env) {
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

async function main() {
  const url = resolveConnectionUrl(process.env);
  if (!url) {
    console.error(
      "cron-health-check did not run: set CRON_CHECK_DATABASE_URL (or DATABASE_URL) to the postgres-role connection string."
    );
    return EXIT_NOT_RUN;
  }

  const names = [...EXPECTED_CRON_JOBS];
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const role = await fetchRole(prisma);
    const [jobs, latestRuns, backgroundJobs] = await Promise.all([
      fetchCronJobs(prisma, names),
      fetchLatestRuns(prisma, names),
      fetchBackgroundJobs(prisma),
    ]);

    const evaluation = evaluateCronHealth({ jobs, latestRuns });
    const lines = formatCronHealthReport({
      evaluation,
      backgroundJobs,
      connection: { ...describeConnection(url), role },
      generatedAt: new Date().toISOString(),
    });
    for (const line of lines) console.log(line);

    if (role !== "postgres") {
      console.log(
        `note: connected as ${role}, not postgres; cron.job rows are visible only to the scheduling role and BackgroundJob is RLS-protected, so a MISSING/empty report may be a role problem.`
      );
    }

    return evaluation.ok ? EXIT_OK : EXIT_PROBLEMS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`cron-health-check did not run: ${message}`);
    return EXIT_NOT_RUN;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => {
  process.exitCode = code;
});
