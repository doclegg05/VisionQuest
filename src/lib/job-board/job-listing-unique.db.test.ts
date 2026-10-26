/**
 * VQ-R-018 — cross-class JobListing collision, integration-verified.
 *
 * `JobListing.sourceId` was a bare, program-wide `@unique` key, and the
 * scrape upsert (`scrape-engine.ts`) matched a row by that key alone with
 * an `update` clause that never touched `classConfigId`. So a shared
 * national posting's `classConfigId` never actually changed hands: class
 * B's scrape found class A's pre-existing row (matched by sourceId alone),
 * overwrote its title/company/description and `scrapeBatchId` with B's
 * version, and never created a row of its own — B got nothing, A's row
 * silently showed B's content while still carrying A's own
 * `classConfigId`, and A's stale-sweep saw the row as freshly touched (by
 * B) and left it alone. Self-healing once the key is class-scoped: the
 * very next scrape of either class no longer matches the other's row, so B
 * creates its own and A rewrites its own correct content on its own
 * following cycle.
 *
 * `JobBrowseListing` already gets this right with
 * `@@unique([source, sourceId])`; this pins the same pattern applied to
 * `JobListing` as `@@unique([classConfigId, source, sourceId])` — a true
 * mirror, with the class scope this table (unlike the program-wide browse
 * pool) has. This is a database CONSTRAINT bug, so it is verified against
 * real Postgres rather than mocked, the same reasoning as
 * `rate-limit.db.test.ts`.
 *
 * Prerequisites (auto-skipped when missing):
 *   - DATABASE_URL points at a migrated Postgres on localhost/127.0.0.1
 *     (see `isLocalOnlyDatabaseUrl` below — the seed-e2e-users precedent:
 *     this test writes and deletes real rows, so it refuses anything that
 *     doesn't clearly look like a disposable local/CI database, never a
 *     shared dev DB or worse).
 *   - JOB_LISTING_UNIQUE_TEST_ENABLED=true. Opt-in on top of the host
 *     check, matching `rate-limit.db.test.ts`'s two-gate pattern.
 *
 * Typical usage:
 *   JOB_LISTING_UNIQUE_TEST_ENABLED=true DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/... \
 *     npx tsx --test src/lib/job-board/job-listing-unique.db.test.ts
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "@prisma/client";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * True when `databaseUrl`'s host is clearly local (localhost/127.0.0.1/::1).
 * Pure and side-effect-free so it can run before any connection opens —
 * same reasoning as `src/lib/e2e-seed-guard.ts`'s host check, inlined here
 * rather than imported so this test file's fence stays self-contained.
 * An unparseable URL is refused, not assumed safe.
 */
export function isLocalOnlyDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    return LOCAL_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

describe("isLocalOnlyDatabaseUrl", () => {
  it("allows localhost and 127.0.0.1", () => {
    assert.equal(isLocalOnlyDatabaseUrl("postgresql://postgres:postgres@localhost:5432/db"), true);
    assert.equal(isLocalOnlyDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:5432/db"), true);
  });

  it("refuses a remote host, even one that looks dev/staging-named", () => {
    assert.equal(isLocalOnlyDatabaseUrl("postgresql://u:p@db.dev.example.com:5432/vq_dev"), false);
    assert.equal(isLocalOnlyDatabaseUrl("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres"), false);
  });

  it("refuses undefined and unparseable input", () => {
    assert.equal(isLocalOnlyDatabaseUrl(undefined), false);
    assert.equal(isLocalOnlyDatabaseUrl("not a url"), false);
  });
});

const SHOULD_RUN =
  process.env.JOB_LISTING_UNIQUE_TEST_ENABLED === "true" && isLocalOnlyDatabaseUrl(process.env.DATABASE_URL);

if (!SHOULD_RUN) {
  describe("JobListing class-scoped uniqueness (integration) — SKIPPED", () => {
    it("requires JOB_LISTING_UNIQUE_TEST_ENABLED=true and a local/127.0.0.1 DATABASE_URL", () => {
      assert.ok(
        true,
        "Set JOB_LISTING_UNIQUE_TEST_ENABLED=true and point DATABASE_URL at a migrated Postgres on localhost/127.0.0.1.",
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
      // P2002 — the exact mechanism that let class B's write silently land
      // on class A's row instead of creating its own.
      await db.jobListing.create({ data: listing(configBetaId) });

      const rows = await db.jobListing.findMany({ where: { sourceId: sharedSourceId } });
      assert.equal(rows.length, 2, "both classes should keep their own copy of the shared posting");
      const classConfigIds = rows.map((r) => r.classConfigId).sort();
      assert.deepEqual(classConfigIds, [configAlphaId, configBetaId].sort());
    });

    it("still refuses a second row for the SAME class, source and sourceId (the constraint is scoped, not removed)", async () => {
      await assert.rejects(
        () => db.jobListing.create({ data: listing(configAlphaId) }),
        (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
        "a duplicate (classConfigId, source, sourceId) triple must still violate a unique constraint",
      );
    });
  });
}
