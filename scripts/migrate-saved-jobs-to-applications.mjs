#!/usr/bin/env node

/**
 * Migration — fold StudentSavedJob rows into the unified Application pipeline
 * (VQ-R-017, locked tracker decision).
 *
 * For every StudentSavedJob (joined to its JobListing):
 *   1. find-or-create the Opportunity deduped by the listing url (oldest row
 *      wins; created rows get type "job" and the listing's fields, with the
 *      saving student as createdById)
 *   2. upsert the Application keyed on (studentId, opportunityId):
 *        - status: keep the RICHEST of the existing Application status and the
 *          saved job's status (applied-family beats saved; existing Application
 *          values win ties). Job-board "offered" is stored as the
 *          Application-model "offer".
 *        - appliedAt: keep the OLDEST non-null of the two
 *        - notes: prefer the existing Application's notes; fall back to the
 *          saved job's
 *        - created rows are stamped verificationStatus "self_reported" (they
 *          are student claims); an existing row's verification is cleared only
 *          when this migration changes its status (the new status supersedes
 *          the instructor's sign-off, mirroring the P1-4 write paths)
 *
 * StudentSavedJob rows are NEVER deleted — they stay for rollback.
 * Idempotent: a re-run finds every Application already at least as rich and
 * changes nothing.
 *
 * DRY-RUN BY DEFAULT — prints what would change and writes nothing.
 *
 * Usage:
 *   npx tsx scripts/migrate-saved-jobs-to-applications.mjs           # dry-run
 *   npx tsx scripts/migrate-saved-jobs-to-applications.mjs --apply   # write
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const APPLY = process.argv.includes("--apply");

/** Job-board "offered" is stored as the Application-model "offer". */
function toApplicationStatus(status) {
  return status === "offered" ? "offer" : status;
}

/**
 * Pipeline richness for merge decisions. Higher wins; an existing Application
 * status wins ties. Statuses outside the map (rejected/accepted — terminal
 * outcome states only the opportunity hub writes) always win over a job-board
 * status.
 */
const STATUS_RANK = {
  saved: 0,
  withdrawn: 1,
  applied: 2,
  interviewing: 3,
  offer: 4,
};

function statusRank(status) {
  return STATUS_RANK[status] ?? Number.MAX_SAFE_INTEGER;
}

function oldestDate(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

async function planMigration(prisma) {
  const savedJobs = await prisma.studentSavedJob.findMany({
    orderBy: { savedAt: "asc" },
    select: {
      id: true,
      studentId: true,
      status: true,
      notes: true,
      savedAt: true,
      appliedAt: true,
      jobListing: {
        select: {
          title: true,
          company: true,
          location: true,
          url: true,
          description: true,
        },
      },
    },
  });

  const plan = {
    scanned: savedJobs.length,
    opportunitiesToCreate: [],
    applicationsToCreate: [],
    applicationsToUpdate: [],
    unchanged: 0,
  };

  // url -> opportunity id (existing) or pending-create marker
  const opportunityByUrl = new Map();
  const urls = [...new Set(savedJobs.map((row) => row.jobListing.url))];
  if (urls.length > 0) {
    const existingOpportunities = await prisma.opportunity.findMany({
      where: { url: { in: urls } },
      orderBy: { createdAt: "asc" },
      select: { id: true, url: true },
    });
    // orderBy asc + first-wins keeps the oldest row per url.
    for (const opportunity of existingOpportunities) {
      if (!opportunityByUrl.has(opportunity.url)) {
        opportunityByUrl.set(opportunity.url, { id: opportunity.id, pending: false });
      }
    }
  }

  for (const savedJob of savedJobs) {
    const { url } = savedJob.jobListing;
    let opportunity = opportunityByUrl.get(url);
    if (!opportunity) {
      opportunity = { id: `pending:${url}`, pending: true };
      opportunityByUrl.set(url, opportunity);
      plan.opportunitiesToCreate.push({
        pendingId: opportunity.id,
        url,
        studentId: savedJob.studentId,
        listing: savedJob.jobListing,
      });
    }

    const existingApplication = opportunity.pending
      ? null
      : await prisma.application.findUnique({
          where: {
            studentId_opportunityId: {
              studentId: savedJob.studentId,
              opportunityId: opportunity.id,
            },
          },
          select: { id: true, status: true, notes: true, appliedAt: true },
        });

    const savedStatus = toApplicationStatus(savedJob.status);

    if (!existingApplication) {
      // Two StudentSavedJob rows can map to one (student, url) when the same
      // posting sat on two class boards — merge them richest-status/oldest-
      // appliedAt within the plan.
      const pendingKey = `${savedJob.studentId}:${url}`;
      const alreadyPlanned = plan.applicationsToCreate.find((entry) => entry.key === pendingKey);
      if (alreadyPlanned) {
        if (statusRank(savedStatus) > statusRank(alreadyPlanned.data.status)) {
          alreadyPlanned.data.status = savedStatus;
        }
        alreadyPlanned.data.appliedAt = oldestDate(alreadyPlanned.data.appliedAt, savedJob.appliedAt);
        alreadyPlanned.data.notes = alreadyPlanned.data.notes ?? savedJob.notes;
        continue;
      }
      plan.applicationsToCreate.push({
        key: pendingKey,
        opportunityRef: opportunity,
        data: {
          studentId: savedJob.studentId,
          status: savedStatus,
          notes: savedJob.notes,
          appliedAt: savedJob.appliedAt,
          createdAt: savedJob.savedAt,
        },
      });
      continue;
    }

    // Merge into the existing Application: richest status (existing wins
    // ties), oldest appliedAt, prefer existing notes.
    const update = {};
    if (statusRank(savedStatus) > statusRank(existingApplication.status)) {
      update.status = savedStatus;
      // A status change supersedes any instructor sign-off (P1-4).
      update.verificationStatus = "self_reported";
      update.verifiedBy = null;
      update.verifiedAt = null;
    }
    const mergedAppliedAt = oldestDate(existingApplication.appliedAt, savedJob.appliedAt);
    if ((mergedAppliedAt?.getTime() ?? null) !== (existingApplication.appliedAt?.getTime() ?? null)) {
      update.appliedAt = mergedAppliedAt;
    }
    if (existingApplication.notes == null && savedJob.notes != null) {
      update.notes = savedJob.notes;
    }

    if (Object.keys(update).length === 0) {
      plan.unchanged += 1;
      continue;
    }
    plan.applicationsToUpdate.push({
      applicationId: existingApplication.id,
      studentId: savedJob.studentId,
      url,
      update,
    });
  }

  return plan;
}

async function applyPlan(prisma, plan) {
  await prisma.$transaction(async (tx) => {
    const createdIdByPending = new Map();
    for (const pending of plan.opportunitiesToCreate) {
      const created = await tx.opportunity.create({
        data: {
          type: "job",
          title: pending.listing.title,
          company: pending.listing.company,
          location: pending.listing.location,
          url: pending.listing.url,
          description: pending.listing.description,
          createdById: pending.studentId,
        },
        select: { id: true },
      });
      createdIdByPending.set(pending.pendingId, created.id);
    }

    for (const entry of plan.applicationsToCreate) {
      const opportunityId = entry.opportunityRef.pending
        ? createdIdByPending.get(entry.opportunityRef.id)
        : entry.opportunityRef.id;
      await tx.application.create({
        data: {
          studentId: entry.data.studentId,
          opportunityId,
          status: entry.data.status,
          notes: entry.data.notes,
          appliedAt: entry.data.appliedAt,
          createdAt: entry.data.createdAt,
          verificationStatus: "self_reported",
        },
      });
    }

    for (const entry of plan.applicationsToUpdate) {
      await tx.application.update({
        where: { id: entry.applicationId },
        data: entry.update,
      });
    }
  });
}

function printSummary(plan) {
  console.log("\nSummary");
  console.log("  StudentSavedJob rows scanned : " + plan.scanned);
  console.log("  Opportunities to create      : " + plan.opportunitiesToCreate.length);
  console.log("  Applications to create       : " + plan.applicationsToCreate.length);
  console.log("  Applications to enrich       : " + plan.applicationsToUpdate.length);
  console.log("  Already migrated (no change) : " + plan.unchanged);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to start. No database was touched.");
    process.exitCode = 1;
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    console.log(
      `${APPLY ? "APPLY" : "Dry-run"}: folding StudentSavedJob rows into the Application pipeline…`,
    );

    const plan = await planMigration(prisma);

    for (const pending of plan.opportunitiesToCreate) {
      console.log(`  + opportunity  url=${pending.url}`);
    }
    for (const entry of plan.applicationsToCreate) {
      console.log(
        `  + application  student=${entry.data.studentId} status=${entry.data.status} url=${entry.key.split(":").slice(1).join(":")}`,
      );
    }
    for (const entry of plan.applicationsToUpdate) {
      console.log(
        `  ~ application  student=${entry.studentId} url=${entry.url} set=${JSON.stringify(entry.update)}`,
      );
    }

    printSummary(plan);

    const changes =
      plan.opportunitiesToCreate.length +
      plan.applicationsToCreate.length +
      plan.applicationsToUpdate.length;

    if (changes === 0) {
      console.log("\nNothing to change — every StudentSavedJob row is already represented.");
      return;
    }

    if (!APPLY) {
      console.log("\nDry-run: nothing written. Re-run with --apply to write.");
      console.log("StudentSavedJob rows are never deleted (kept for rollback).");
      return;
    }

    await applyPlan(prisma, plan);
    console.log("\nApplied. StudentSavedJob rows were left in place for rollback.");
    console.log("Re-running now reports nothing to change (idempotent).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
