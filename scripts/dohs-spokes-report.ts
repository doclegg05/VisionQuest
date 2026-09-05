#!/usr/bin/env node

/**
 * The DoHS-facing statistical export, run from the command line
 * (docs/superpowers/plans/2026-09-05-match-and-connect.md, Task 6.2).
 *
 * Same row shape and column list as `GET /api/teacher/reports/connect/
 * export.csv` (src/lib/connect/dohs-export-shared.ts owns both), but
 * program-wide by default rather than scoped to one instructor's managed
 * students — this is the whole-program file DoHS actually wants, run by an
 * operator rather than a teacher session.
 *
 * P0.4(1) — WVDE's exact statistical-report field list — is still
 * unanswered; DOHS_EXPORT_COLUMNS is this program's best guess. Reconcile
 * both when the real list lands (see the header comment on
 * dohs-export-shared.ts).
 *
 * Connection: ADMIN_DATABASE_URL, falling back to DATABASE_URL, same as
 * scripts/backfill-employers.ts and scripts/pathway-outcomes-report.ts — a
 * script has no session role, so under `vq_app` RLS would hide every row and
 * report an empty program as success. Probes `rolbypassrls` first and
 * refuses to run without it, same reasoning as the employer backfill.
 *
 * No student identifiers are printed to the console — only written to the
 * CSV file, whose path the operator chose.
 *
 * Usage:
 *   ADMIN_DATABASE_URL="..." npx tsx scripts/dohs-spokes-report.ts --out=report.csv
 *   ADMIN_DATABASE_URL="..." npx tsx scripts/dohs-spokes-report.ts --from=2026-01-01 --to=2026-06-30 --out=report.csv
 *   ADMIN_DATABASE_URL="..." npx tsx scripts/dohs-spokes-report.ts --class=<SpokesClass id> --out=report.csv
 *
 * Exit codes: 0 written, 2 no connection string, a connection whose role
 * cannot see the rows, or a missing/malformed argument.
 */

import { writeFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

import { buildDohsExportCsv, buildDohsExportRows } from "../src/lib/connect/dohs-export-shared";

loadEnvConfig(process.cwd(), true);

const EXIT_OK = 0;
const EXIT_USAGE = 2;

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function resolveConnectionUrl(env: NodeJS.ProcessEnv): string | null {
  const url = env.ADMIN_DATABASE_URL || env.DATABASE_URL || "";
  return url.trim() || null;
}

/** Host and database only — never the credentials. */
function describeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname || "(socket)"}/${parsed.pathname.replace(/^\//, "") || "(default)"}`;
  } catch {
    return "(unparseable url)";
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

async function main(): Promise<number> {
  const out = argValue("out");
  const fromRaw = argValue("from");
  const toRaw = argValue("to");
  const classId = argValue("class");

  if (!out) {
    console.error("Missing --out=<path>. Nothing was written.");
    return EXIT_USAGE;
  }
  if (fromRaw && !DATE_ONLY.test(fromRaw)) {
    console.error(`--from must be YYYY-MM-DD, got "${fromRaw}".`);
    return EXIT_USAGE;
  }
  if (toRaw && !DATE_ONLY.test(toRaw)) {
    console.error(`--to must be YYYY-MM-DD, got "${toRaw}".`);
    return EXIT_USAGE;
  }

  const url = resolveConnectionUrl(process.env);
  if (!url) {
    console.error("No ADMIN_DATABASE_URL or DATABASE_URL set.");
    return EXIT_USAGE;
  }

  console.log(`DoHS SPOKES report — reading from ${describeConnection(url)}`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    // Same probe as backfill-employers.ts: under vq_app every SpokesRecord
    // would be RLS-invisible, and an empty result set would look exactly
    // like an empty program rather than a permission failure.
    const [role] = await prisma.$queryRaw<Array<{ rolbypassrls: boolean; current_user: string }>>`
      SELECT rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user
    `;
    if (!role?.rolbypassrls) {
      console.error(
        `Connected as "${role?.current_user ?? "unknown"}", which does not bypass RLS.\n` +
          "Every SpokesRecord would be invisible and this script would report an " +
          "empty program rather than a permission failure. Set ADMIN_DATABASE_URL " +
          "to the postgres-role connection string.",
      );
      return EXIT_USAGE;
    }

    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    const records = await prisma.spokesRecord.findMany({
      where: {
        studentId: { not: null },
        ...(classId
          ? { student: { classEnrollments: { some: { classId, status: "active" } } } }
          : {}),
        ...(from || to
          ? { enrolledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      select: {
        studentId: true,
        enrolledAt: true,
        exitDate: true,
        unsubsidizedEmploymentAt: true,
        employerName: true,
        hourlyWage: true,
        student: {
          select: {
            studentId: true,
            classEnrollments: {
              where: { status: "active" },
              orderBy: { enrolledAt: "desc" },
              take: 1,
              select: { class: { select: { name: true } } },
            },
          },
        },
        placementApplication: {
          select: {
            verificationStatus: true,
            connection: {
              select: { status: true, packet: true, jobLead: { select: { schedule: true } } },
            },
          },
        },
        employmentFollowUps: {
          orderBy: { checkedAt: "desc" },
          take: 1,
          select: { checkedAt: true },
        },
      },
      orderBy: { enrolledAt: "asc" },
    });

    const rows = buildDohsExportRows(
      records.map((record) => ({
        spokesId: record.student?.studentId ?? null,
        className: record.student?.classEnrollments[0]?.class.name ?? null,
        enrollmentDate: record.enrolledAt,
        exitDate: record.exitDate,
        unsubsidizedEmploymentAt: record.unsubsidizedEmploymentAt,
        employerName: record.employerName,
        hourlyWage: record.hourlyWage,
        placementApplication: record.placementApplication
          ? {
              verificationStatus: record.placementApplication.verificationStatus,
              connection: record.placementApplication.connection
                ? {
                    status: record.placementApplication.connection.status,
                    packet: record.placementApplication.connection.packet,
                    jobLeadSchedule: record.placementApplication.connection.jobLead.schedule,
                  }
                : null,
            }
          : null,
        latestFollowUpAt: record.employmentFollowUps[0]?.checkedAt ?? null,
      })),
    );

    writeFileSync(out, buildDohsExportCsv(rows));
    console.log(`Wrote ${rows.length} rows to ${out}.`);
    return EXIT_OK;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("DoHS SPOKES report failed:", error);
    process.exitCode = 1;
  });
