/**
 * Region-scoping integration test for the coordinator forms rollup (C7).
 *
 * The auth matrix is pinned by src/app/api/coordinator/forms-rollup-auth.test.ts
 * with mocks. THIS file answers the question mocks cannot: with two real
 * regions in one database, does the rollup ever count a student who belongs to
 * the other one? A `where` clause that looks right and does not bind is the
 * failure this file exists to catch, so every count below is compared against
 * the number of rows actually seeded in each region.
 *
 * Prerequisites (auto-skipped if missing):
 *   - DATABASE_URL / ADMIN_DATABASE_URL point at a MIGRATED Postgres
 *     (`prisma migrate deploy`, never `db push` — partial unique indexes).
 *   - REGION_ROLLUP_DB_TEST=true. Opt-in because it writes fixture rows.
 *
 * Usage:
 *   REGION_ROLLUP_DB_TEST=true \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vq_scoping \
 *   ADMIN_DATABASE_URL=$DATABASE_URL \
 *     npx tsx --test src/lib/forms/region-rollup.db.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";

const ENABLED = process.env.REGION_ROLLUP_DB_TEST === "true" && Boolean(process.env.DATABASE_URL);

const SUFFIX = `rrb${Date.now().toString(36)}`;
const id = (name: string) => `${SUFFIX}-${name}`;

let db: PrismaClient;
let getRegionFormRollup: typeof import("./region-rollup").getRegionFormRollup;
let coordinatorCanReadRegion: typeof import("./region-rollup").coordinatorCanReadRegion;

async function seed() {
  await db.region.createMany({
    data: [
      { id: id("rgnA"), name: "Region A", code: id("A") },
      { id: id("rgnB"), name: "Region B", code: id("B") },
    ],
  });

  await db.student.createMany({
    data: [
      { id: id("coordA"), studentId: id("coordA"), displayName: "Coord A", role: "coordinator" },
      { id: id("coordB"), studentId: id("coordB"), displayName: "Coord B", role: "coordinator" },
      // Region A carries MIN_CELL_SIZE students so its per-template counts
      // are reported; region B stays below it on purpose (W1).
      ...Array.from({ length: 5 }, (_, i) => ({
        id: id(`stuA${i + 1}`),
        studentId: id(`stuA${i + 1}`),
        displayName: `Student A${i + 1}`,
      })),
      { id: id("stuB1"), studentId: id("stuB1"), displayName: "Student B1" },
      { id: id("stuNone"), studentId: id("stuNone"), displayName: "Student Unregioned" },
    ],
  });

  await db.regionCoordinator.createMany({
    data: [
      { regionId: id("rgnA"), coordinatorId: id("coordA") },
      { regionId: id("rgnB"), coordinatorId: id("coordB") },
    ],
  });

  await db.spokesClass.createMany({
    data: [
      { id: id("clsA"), name: "Class A", code: id("clsA"), regionId: id("rgnA") },
      // Archived class in region A: excluded, mirroring classIdsInRegion.
      {
        id: id("clsAarch"),
        name: "Class A archived",
        code: id("clsAarch"),
        regionId: id("rgnA"),
        status: "archived",
      },
      { id: id("clsB"), name: "Class B", code: id("clsB"), regionId: id("rgnB") },
      { id: id("clsNone"), name: "Class unregioned", code: id("clsNone") },
    ],
  });

  await db.studentClassEnrollment.createMany({
    data: [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: id(`enrA${i + 1}`),
        classId: id("clsA"),
        studentId: id(`stuA${i + 1}`),
      })),
      { id: id("enrB1"), classId: id("clsB"), studentId: id("stuB1") },
      { id: id("enrNone"), classId: id("clsNone"), studentId: id("stuNone") },
      // Region A's archived class holds the region-B student. If the rollup
      // ever counted archived classes it would pull a foreign student in.
      { id: id("enrArch"), classId: id("clsAarch"), studentId: id("stuB1") },
    ],
  });

  await db.formTemplate.create({
    data: { id: id("tpl"), title: "Intake", schema: { fields: [] }, isOfficial: true },
  });

  // One submitted response per student, in every region plus the unregioned
  // class. Region A must count exactly one (stuA1); stuA2 has none.
  await db.formResponse.createMany({
    data: [
      {
        id: id("respA1"),
        templateId: id("tpl"),
        studentId: id("stuA1"),
        answers: {},
        status: "submitted",
      },
      {
        id: id("respB1"),
        templateId: id("tpl"),
        studentId: id("stuB1"),
        answers: {},
        status: "submitted",
      },
      {
        id: id("respNone"),
        templateId: id("tpl"),
        studentId: id("stuNone"),
        answers: {},
        status: "submitted",
      },
    ],
  });

  await db.formAssignment.createMany({
    data: [
      { id: id("asgA"), templateId: id("tpl"), scope: "class", targetId: id("clsA") },
      { id: id("asgB"), templateId: id("tpl"), scope: "class", targetId: id("clsB") },
      { id: id("asgNone"), templateId: id("tpl"), scope: "class", targetId: id("clsNone") },
    ],
  });
}

async function cleanup() {
  await db.formResponse.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.formAssignment.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.formTemplate.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.studentClassEnrollment.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.spokesClass.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.regionCoordinator.deleteMany({ where: { regionId: { startsWith: SUFFIX } } });
  await db.student.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.region.deleteMany({ where: { id: { startsWith: SUFFIX } } });
}

describe("getRegionFormRollup region scoping", { skip: !ENABLED }, () => {
  before(async () => {
    db = new PrismaClient();
    ({ getRegionFormRollup, coordinatorCanReadRegion } = await import("./region-rollup"));
    await cleanup();
    await seed();
  });

  after(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("counts only region A's students, classes and responses", async () => {
    const rollup = await getRegionFormRollup(id("rgnA"));

    assert.equal(rollup.classCount, 1, "the archived class in region A is excluded");
    assert.equal(rollup.studentCount, 5, "region A's own roster, never stuB1 or stuNone");

    const row = rollup.templates.find((t) => t.templateId === id("tpl"));
    assert.ok(row, "the active template appears");
    assert.equal(row.suppressed, false, "region A is at the minimum cell size");
    assert.equal(row.responseCount, 1, "only stuA1's response — not B's, not the unregioned one");
    assert.equal(row.assignmentCount, 1, "only the assignment targeting region A's class");
  });

  it("suppresses region B's per-template counts: one student, one named form (W1)", async () => {
    const rollup = await getRegionFormRollup(id("rgnB"));

    // The region's own size is still reported — knowing a region is small
    // discloses nothing about anyone in it, and hiding it would leave the
    // reader unable to tell "no data" from "too little data".
    assert.equal(rollup.classCount, 1);
    assert.equal(rollup.studentCount, 1, "stuB1 only");

    const row = rollup.templates.find((t) => t.templateId === id("tpl"));
    assert.ok(row);
    assert.equal(row.suppressed, true);
    assert.equal(row.responseCount, null, "stuB1 DID respond; the count is still withheld");
    assert.equal(row.assignmentCount, null);
    assert.equal(row.completionRate, null);
  });

  it("region A's counts exclude every out-of-region response", async () => {
    const a = await getRegionFormRollup(id("rgnA"));
    // Three responses exist (stuA1, stuB1, stuNone). Region A may see one.
    assert.equal(a.templates.find((t) => t.templateId === id("tpl"))?.responseCount, 1);
  });

  it("returns an empty rollup for a region with no classes", async () => {
    const empty = await db.region.create({
      data: { id: id("rgnEmpty"), name: "Empty", code: id("E") },
    });
    try {
      const rollup = await getRegionFormRollup(empty.id);
      assert.deepEqual(rollup, {
        regionId: empty.id,
        classCount: 0,
        studentCount: 0,
        templates: [],
      });
    } finally {
      await db.region.delete({ where: { id: empty.id } });
    }
  });

  it("a coordinator can read only the region they are assigned to", async () => {
    const coordA = { id: id("coordA"), studentId: id("coordA"), displayName: "Coord A", role: "coordinator" };

    assert.equal(await coordinatorCanReadRegion(coordA, id("rgnA")), true);
    assert.equal(
      await coordinatorCanReadRegion(coordA, id("rgnB")),
      false,
      "region B belongs to coordB",
    );
  });

  it("a teacher session is refused even with a matching region row", async () => {
    const teacherShapedSession = {
      id: id("coordA"),
      studentId: id("coordA"),
      displayName: "Coord A",
      role: "teacher",
    };
    assert.equal(await coordinatorCanReadRegion(teacherShapedSession, id("rgnA")), false);
  });
});
