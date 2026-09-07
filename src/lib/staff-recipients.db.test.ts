/**
 * Integration proof for findAssignedInstructors' three filters (W2 + S1).
 *
 * The mocked suites in advising-interventions.test.ts and
 * crisis-detection.test.ts drive a stubbed prismaAdmin that ignores the
 * `where` clause, so they can prove what the callers do with a recipient set
 * but not which rows Postgres actually returns. THIS file answers that: real
 * rows, real joins, one student whose roster deliberately contains every kind
 * of instructor that must not be notified.
 *
 * Prerequisites (auto-skipped if missing):
 *   - DATABASE_URL / ADMIN_DATABASE_URL point at a MIGRATED Postgres
 *     (`prisma migrate deploy`, never `db push`).
 *   - STAFF_RECIPIENTS_DB_TEST=true. Opt-in because it writes fixture rows.
 *
 * Usage:
 *   STAFF_RECIPIENTS_DB_TEST=true \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vq_scoping2 \
 *   ADMIN_DATABASE_URL=$DATABASE_URL \
 *     npx tsx --test src/lib/staff-recipients.db.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";

const ENABLED =
  process.env.STAFF_RECIPIENTS_DB_TEST === "true" && Boolean(process.env.DATABASE_URL);

const SUFFIX = `sr${Date.now().toString(36)}`;
const id = (name: string) => `${SUFFIX}-${name}`;

let db: PrismaClient;
let findAssignedInstructors: typeof import("./staff-recipients").findAssignedInstructors;
let listActiveTeachers: typeof import("./staff-recipients").listActiveTeachers;

const STAFF = [
  // Must be notified.
  { key: "teacherActive", role: "teacher", isActive: true },
  { key: "adminActive", role: "admin", isActive: true },
  // Must NOT be notified, one reason each.
  { key: "teacherInactive", role: "teacher", isActive: false },
  { key: "coordinator", role: "coordinator", isActive: true },
  { key: "studentRole", role: "student", isActive: true },
  { key: "cdc", role: "cdc", isActive: true },
  // Teaches only the archived class (S1).
  { key: "archivedOnly", role: "teacher", isActive: true },
];

async function seed() {
  await db.student.createMany({
    data: [
      { id: id("student"), studentId: id("student"), displayName: "The Student" },
      ...STAFF.map((staff) => ({
        id: id(staff.key),
        studentId: id(staff.key),
        displayName: staff.key,
        email: `${staff.key}@example.test`,
        role: staff.role,
        isActive: staff.isActive,
      })),
    ],
  });

  await db.spokesClass.createMany({
    data: [
      { id: id("clsLive"), name: "Live", code: id("clsLive") },
      { id: id("clsArchived"), name: "Archived", code: id("clsArchived"), status: "archived" },
    ],
  });

  await db.spokesClassInstructor.createMany({
    data: [
      // Every kind of account on the live class — SpokesClassInstructor has no
      // role constraint, which is the whole point of W2.
      ...STAFF.filter((s) => s.key !== "archivedOnly").map((staff) => ({
        classId: id("clsLive"),
        instructorId: id(staff.key),
      })),
      { classId: id("clsArchived"), instructorId: id("archivedOnly") },
      // Also on the archived class: proves dedupe does not resurrect anyone.
      { classId: id("clsArchived"), instructorId: id("teacherActive") },
    ],
  });

  await db.studentClassEnrollment.createMany({
    data: [
      { id: id("enrLive"), classId: id("clsLive"), studentId: id("student") },
      { id: id("enrArchived"), classId: id("clsArchived"), studentId: id("student") },
    ],
  });
}

async function cleanup() {
  await db.studentClassEnrollment.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.spokesClassInstructor.deleteMany({ where: { classId: { startsWith: SUFFIX } } });
  await db.spokesClass.deleteMany({ where: { id: { startsWith: SUFFIX } } });
  await db.student.deleteMany({ where: { id: { startsWith: SUFFIX } } });
}

describe("findAssignedInstructors filters", { skip: !ENABLED }, () => {
  before(async () => {
    db = new PrismaClient();
    ({ findAssignedInstructors, listActiveTeachers } = await import("./staff-recipients"));
    await cleanup();
    await seed();
  });

  after(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("returns exactly the active staff instructors of non-archived classes", async () => {
    const resolved = await findAssignedInstructors(id("student"));

    assert.deepEqual(
      resolved.map((recipient) => recipient.id).sort(),
      [id("adminActive"), id("teacherActive")].sort(),
    );
  });

  it("excludes a coordinator linked as an instructor (W2)", async () => {
    const ids = (await findAssignedInstructors(id("student"))).map((r) => r.id);
    assert.equal(
      ids.includes(id("coordinator")),
      false,
      "assertStaffRecipient would refuse this recipient's notification anyway",
    );
  });

  it("excludes student-role and unknown-role accounts linked as instructors", async () => {
    const ids = (await findAssignedInstructors(id("student"))).map((r) => r.id);
    assert.equal(ids.includes(id("studentRole")), false);
    assert.equal(ids.includes(id("cdc")), false);
  });

  it("excludes a deactivated teacher", async () => {
    const ids = (await findAssignedInstructors(id("student"))).map((r) => r.id);
    assert.equal(ids.includes(id("teacherInactive")), false);
  });

  it("excludes an instructor whose only link is an archived class (S1)", async () => {
    const ids = (await findAssignedInstructors(id("student"))).map((r) => r.id);
    assert.equal(ids.includes(id("archivedOnly")), false);
  });

  it("returns one row per instructor even when linked through two classes", async () => {
    const resolved = await findAssignedInstructors(id("student"));
    assert.equal(
      resolved.filter((r) => r.id === id("teacherActive")).length,
      1,
      "teacherActive instructs both the live and the archived class",
    );
  });

  it("carries the fields the callers' email bodies need", async () => {
    const teacher = (await findAssignedInstructors(id("student"))).find(
      (r) => r.id === id("teacherActive"),
    );
    assert.ok(teacher);
    assert.equal(teacher.email, "teacherActive@example.test");
    assert.equal(teacher.displayName, "teacherActive");
  });

  it("the program-wide fallback is teachers only — not admins, not coordinators", async () => {
    const ids = (await listActiveTeachers()).map((r) => r.id);
    assert.equal(ids.includes(id("teacherActive")), true);
    assert.equal(ids.includes(id("adminActive")), false);
    assert.equal(ids.includes(id("coordinator")), false);
    assert.equal(ids.includes(id("teacherInactive")), false);
  });
});
