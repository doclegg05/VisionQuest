#!/usr/bin/env node

/**
 * Backfill Employer and JobLead from the free text that was the program's
 * only employer record before Match & Connect Phase 3 existed
 * (docs/superpowers/plans/2026-09-05-match-and-connect.md, Task 3.1).
 *
 * Sources, per the design spec §4:
 *   - distinct `Opportunity.company`      → one Employer per distinct name
 *   - distinct `SpokesRecord.employerName` → same, plus it marks the employer
 *     as having hired a SPOKES graduate before, which the matcher rewards
 *   - each `Opportunity`                   → one JobLead(source: "opportunity",
 *     sourceRef: <opportunity id>)
 *
 * Idempotent by construction, not by convention:
 *   - Employer.nameKey is UNIQUE, so the employer upsert is a no-op on rerun
 *   - a lead is created only when no row already carries the same
 *     (source, sourceRef) pair
 * A second run therefore reports 0 created and changes nothing. The script
 * ends by reading the rows back and asserting the counts it expected.
 *
 * Dry run by default: it prints exactly what it would create and writes
 * nothing. `--apply` performs the writes.
 *
 * Connection: ADMIN_DATABASE_URL, falling back to DATABASE_URL. Employer,
 * EmployerContact and JobLead are RLS-protected with staff-only write
 * policies, and a script has no session role — under vq_app every read comes
 * back EMPTY and every write is rejected. That failure is silent and looks
 * exactly like success (empty plan, nothing to create, read-back of 0 === 0),
 * so the script probes `rolbypassrls` first and refuses to run without it.
 * Run it as the postgres role.
 *
 * No student identifiers are read or printed. SpokesRecord is touched only
 * for its `employerName` and `unsubsidizedEmploymentAt` columns.
 *
 * Usage:
 *   ADMIN_DATABASE_URL="..." npx tsx scripts/backfill-employers.ts            (dry run)
 *   ADMIN_DATABASE_URL="..." npx tsx scripts/backfill-employers.ts --apply
 *   npm run employers:backfill -- --apply
 *
 * Exit codes: 0 done (dry run or applied), 2 no connection string or a
 * connection whose role cannot see the rows.
 */

import { PrismaClient } from "@prisma/client";

import {
  planEmployerBackfill,
  type EmployerBackfillPlan,
} from "../src/lib/connect/employers-shared";

const EXIT_OK = 0;
const EXIT_USAGE = 2;

/**
 * The county and city an employer gets when nothing in the source rows says.
 * Both columns are required, and an instructor fixes them from the console —
 * a guess would look like a fact.
 */
const UNKNOWN_PLACE = "Unknown";

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

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const url = resolveConnectionUrl(process.env);
  if (!url) {
    console.error("No ADMIN_DATABASE_URL or DATABASE_URL set.");
    return EXIT_USAGE;
  }

  console.log(`Employer backfill — ${apply ? "APPLY" : "dry run"} against ${describeConnection(url)}`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    // The probe that stops this script reporting success over an empty result
    // set. Under vq_app the RLS policies hide every source row, so the plan
    // comes out empty, nothing is created, and the read-back trivially passes.
    const [role] = await prisma.$queryRaw<Array<{ rolbypassrls: boolean; current_user: string }>>`
      SELECT rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user
    `;
    if (!role?.rolbypassrls) {
      console.error(
        `Connected as "${role?.current_user ?? "unknown"}", which does not bypass RLS.\n` +
          "Every source row would be invisible and this script would report success " +
          "having written nothing. Set ADMIN_DATABASE_URL to the postgres-role " +
          "connection string.",
      );
      return EXIT_USAGE;
    }

    const [opportunities, placements] = await Promise.all([
      prisma.opportunity.findMany({
        select: {
          id: true,
          title: true,
          company: true,
          location: true,
          description: true,
          status: true,
        },
      }),
      prisma.spokesRecord.findMany({
        where: { employerName: { not: null } },
        select: { employerName: true, unsubsidizedEmploymentAt: true },
      }),
    ]);

    if (opportunities.length === 0 && placements.length === 0) {
      // Not an error — a brand-new install genuinely has neither — but it must
      // never print "complete", because that is indistinguishable from the RLS
      // failure above and from a wrong DATABASE_URL.
      console.log(
        "  no Opportunity rows and no SpokesRecord employer names — nothing to back fill.",
      );
      return EXIT_OK;
    }

    const plan: EmployerBackfillPlan = planEmployerBackfill(opportunities, placements);
    console.log(
      `  read ${opportunities.length} opportunities and ${placements.length} placement rows`,
    );
    console.log(`  ${plan.employers.length} distinct employers`);
    console.log(`  ${plan.leads.length} leads from opportunities`);

    const existingEmployers = await prisma.employer.findMany({
      where: { nameKey: { in: plan.employers.map((employer) => employer.nameKey) } },
      select: { nameKey: true },
    });
    const existingEmployerKeys = new Set(existingEmployers.map((row) => row.nameKey));

    const existingLeads = await prisma.jobLead.findMany({
      where: { source: "opportunity", sourceRef: { in: plan.leads.map((lead) => lead.sourceRef) } },
      select: { sourceRef: true },
    });
    const existingLeadRefs = new Set(existingLeads.map((row) => row.sourceRef));

    const newEmployers = plan.employers.filter(
      (employer) => !existingEmployerKeys.has(employer.nameKey),
    );
    const newLeads = plan.leads.filter((lead) => !existingLeadRefs.has(lead.sourceRef));

    console.log(`  ${newEmployers.length} employers to create, ${existingEmployerKeys.size} already there`);
    console.log(`  ${newLeads.length} leads to create, ${existingLeadRefs.size} already there`);

    if (!apply) {
      for (const employer of newEmployers.slice(0, 20)) {
        console.log(
          `    + employer "${employer.name}"${employer.hiredSpokesGradBefore ? " (has hired a SPOKES grad)" : ""}`,
        );
      }
      if (newEmployers.length > 20) console.log(`    … and ${newEmployers.length - 20} more`);
      console.log("Dry run — nothing written. Re-run with --apply.");
      return EXIT_OK;
    }

    // Employers first: every lead needs its employer's id. One statement with
    // skipDuplicates rather than a loop of upserts — the unique nameKey makes
    // a concurrent run or a rerun a no-op rather than a conflict.
    await prisma.employer.createMany({
      data: newEmployers.map((employer) => ({
        name: employer.name,
        nameKey: employer.nameKey,
        county: UNKNOWN_PLACE,
        city: UNKNOWN_PLACE,
        hiredSpokesGradBefore: employer.hiredSpokesGradBefore,
        lastHiredAt: employer.lastHiredAt,
      })),
      skipDuplicates: true,
    });

    // Hire history is the one thing a rerun DOES refresh, because a placement
    // recorded since the last run is new information. Name, county, city,
    // notes and status may have been edited by an instructor, and a rerun must
    // not undo that work — so they are never in an update.
    for (const employer of plan.employers.filter((row) => row.hiredSpokesGradBefore)) {
      await prisma.employer.updateMany({
        where: { nameKey: employer.nameKey },
        data: { hiredSpokesGradBefore: true, lastHiredAt: employer.lastHiredAt },
      });
    }

    const employerRows = await prisma.employer.findMany({
      where: { nameKey: { in: plan.employers.map((employer) => employer.nameKey) } },
      select: { id: true, name: true, nameKey: true },
    });
    const employerByKey = new Map(employerRows.map((row) => [row.nameKey, row] as const));

    const leadRows = newLeads.flatMap((lead) => {
      const employer = employerByKey.get(lead.employerNameKey);
      if (!employer) return [];
      return [
        {
          employerId: employer.id,
          // Denormalised on the lead so the student path never has to read
          // the Employer table, whose policy has no student branch.
          employerName: employer.name,
          title: lead.title,
          description: lead.description,
          location: lead.location,
          source: lead.source,
          sourceRef: lead.sourceRef,
          status: lead.status,
          // classId stays null: an Opportunity was never class-scoped, so the
          // backfilled lead is program-wide, which is what students saw before.
          classId: null,
        },
      ];
    });

    // skipDuplicates leans on @@unique([source, sourceRef]): a rerun, or two
    // operators running this at once, cannot produce a second lead per
    // Opportunity.
    const created = await prisma.jobLead.createMany({ data: leadRows, skipDuplicates: true });
    const createdLeads = created.count;

    // Read-back assertion: what the database holds now must match the plan.
    const [employerCount, leadCount] = await Promise.all([
      prisma.employer.count({
        where: { nameKey: { in: plan.employers.map((employer) => employer.nameKey) } },
      }),
      prisma.jobLead.count({
        where: {
          source: "opportunity",
          sourceRef: { in: plan.leads.map((lead) => lead.sourceRef) },
        },
      }),
    ]);

    console.log(`  created ${createdLeads} leads`);
    console.log(`  read back ${employerCount}/${plan.employers.length} employers, ${leadCount}/${plan.leads.length} leads`);

    if (employerCount !== plan.employers.length || leadCount !== plan.leads.length) {
      throw new Error(
        `read-back mismatch: expected ${plan.employers.length} employers and ${plan.leads.length} leads`,
      );
    }

    console.log("Backfill complete. Re-running is a no-op.");
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
    console.error("Employer backfill failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
