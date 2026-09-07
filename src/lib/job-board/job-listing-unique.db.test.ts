/**
 * VQ-R-018 — cross-class JobListing collision, integration-verified.
 *
 * `JobListing.sourceId` was a bare, program-wide `@unique` key, and the
 * scrape upsert (`scrape-engine.ts`) keyed on it alone. Two classes whose
 * regions both surface the same national posting (a USAJobs/Greenhouse/
 * Lever listing, say) collided: the second class's overnight refresh
 * reassigned that row's `classConfigId`, silently vanishing it from the
 * first class's board. `JobBrowseListing` already gets this right with
 * `@@unique([source, sourceId])`; this pins the same pattern applied to
 * `JobListing` as `@@unique([classConfigId, sourceId])` — this is a
 * database CONSTRAINT bug, so it is verified against real Postgres rather
 * than mocked, the same reasoning as `rate-limit.db.test.ts`.
 *
 * Prerequisites (auto-skipped when missing):
 *   - DATABASE_URL points at a migrated, NON-PRODUCTION Postgres.
 *   - JOB_LISTING_UNIQUE_TEST_ENABLED=true. Opt-in because this test writes
 *     real SpokesClass/JobClassConfig/JobListing rows (cleaned up after).
 *
 * Typical usage:
 *   JOB_LISTING_UNIQUE_TEST_ENABLED=true DATABASE_URL=postgres://...test... \
 *     npx tsx --test src/lib/job-board/job-listing-unique.db.test.ts
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "@prisma/client";

const SHOULD_RUN = process.env.JOB_LISTING_UNIQUE_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;

if (!SHOULD_RUN) {
  describe("JobListing class-scoped uniqueness (integration) — SKIPPED", () => {
    it("requires JOB_LISTING_UNIQUE_TEST_ENABLED=true and DATABASE_URL pointing at a test DB", () => {
      assert.ok(
        true,
        "Set JOB_LISTING_UNIQUE_TEST_ENABLED=true and point DATABASE_URL at a non-production, migrated DB.",
      );
    });
  });
} else {
  describe("JobListing class-scoped uniqueness (integration)", () => {
    const db = new PrismaClient();
    const suffix = `jlu${Date.now()}${Math.floor(Math.random() * 1000)}`;
    let classAlphaId = "";
    let classBetaId = "";
    let configAlphaId = "";
    let configBetaId = "";
    const sharedSourceId = `usajobs:shared-posting-${suffix}`;

    before(async () => {
      const classAlpha = await db.spokesClass.create({
        data: { name: `Alpha ${suffix}`, code: `ALPHA-${suffix}` },
      });
      const classBeta = await db.spokesClass.create({
        data: { name: `Beta ${suffix}`, code: `BETA-${suffix}` },
      });
      classAlphaId = classAlpha.id;
      classBetaId = classBeta.id;

      const configAlpha = await db.jobClassConfig.create({
        data: { classId: classAlphaId, region: "Charleston, WV" },
      });
      const configBeta = await db.jobClassConfig.create({
        data: { classId: classBetaId, region: "Huntington, WV" },
      });
      configAlphaId = configAlpha.id;
      configBetaId = configBeta.id;
    });

    after(async () => {
      // Order matters: JobListing -> JobClassConfig -> SpokesClass.
      await db.jobListing.deleteMany({ where: { sourceId: { startsWith: `usajobs:shared-posting-${suffix}` } } });
      await db.jobClassConfig.deleteMany({ where: { id: { in: [configAlphaId, configBetaId] } } });
      await db.spokesClass.deleteMany({ where: { id: { in: [classAlphaId, classBetaId] } } });
      await db.$disconnect();
    });

    function listing(classConfigId: string, overrides: Partial<Prisma.JobListingCreateInput> = {}) {
      return {
        title: "Administrative Assistant",
        company: "West Virginia Division of Highways",
        location: "Charleston, WV",
        description: "Shared national posting surfaced by two classes' regions.",
        url: "https://www.usajobs.gov/job/shared-posting",
        source: "usajobs",
        sourceType: "api",
        sourceId: sharedSourceId,
        scrapeBatchId: `batch-${suffix}`,
        classConfig: { connect: { id: classConfigId } },
        ...overrides,
      } satisfies Prisma.JobListingCreateInput;
    }

    it("lets two different classes each hold a JobListing with the same (source, sourceId)", async () => {
      await db.jobListing.create({ data: listing(configAlphaId) });

      // Before the fix, this second class's copy of the SAME national
      // posting collides on the bare `sourceId @unique` key and throws
      // P2002 — the exact mechanism that silently reassigned the row away
      // from class Alpha's board on the next scrape.
      await db.jobListing.create({ data: listing(configBetaId) });

      const rows = await db.jobListing.findMany({ where: { sourceId: sharedSourceId } });
      assert.equal(rows.length, 2, "both classes should keep their own copy of the shared posting");
      const classConfigIds = rows.map((r) => r.classConfigId).sort();
      assert.deepEqual(classConfigIds, [configAlphaId, configBetaId].sort());
    });

    it("still refuses a second row for the SAME class and sourceId (the constraint is scoped, not removed)", async () => {
      await assert.rejects(
        () => db.jobListing.create({ data: listing(configAlphaId) }),
        (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
        "a duplicate (classConfigId, sourceId) pair must still violate a unique constraint",
      );
    });
  });
}
