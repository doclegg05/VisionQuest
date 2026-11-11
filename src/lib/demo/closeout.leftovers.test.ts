/**
 * What the demo closeout finds that it does not delete, and the rows it reaches
 * only through text (readiness H10): orphaned ids in columns with no foreign
 * key, queued jobs whose payload names a demo account, program settings and
 * staff notifications that mention one, and the files left in storage.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REFUSALS, runDemoCloseout, type CloseoutOptions, type CloseoutOutcome, type CloseoutPreview } from "./closeout";
import { FAKE_MIGRATION, LOCAL, copyOf, scene, type FakeDb } from "./closeout.fixtures";

const preview = (db: FakeDb, extra: Partial<CloseoutOptions> = {}): Promise<CloseoutOutcome> =>
  runDemoCloseout(db.client(), { apply: false, env: {}, local: LOCAL, ...extra });
const apply = (db: FakeDb, extra: Partial<CloseoutOptions> = {}): Promise<CloseoutOutcome> =>
  runDemoCloseout(db.client(), { apply: true, env: {}, local: LOCAL, expectAccounts: 2, ...extra });

function countsOf(outcome: CloseoutOutcome): CloseoutPreview {
  if (outcome.kind === "unreadable") throw new Error(`expected counts, got ${outcome.kind}`);
  return outcome.preview;
}

const total = (counts: Readonly<Record<string, number>>): number => Object.values(counts).reduce((sum, count) => sum + count, 0);

describe("demo closeout orphan counts", () => {
  it("counts rows that name an account or class that does not exist, column by column", async () => {
    const { db } = await scene();
    db.insert("AuditLog", { action: "x", targetType: "student", actorId: "gone-staff", targetId: "gone-student" });
    db.insert("AuditLog", { action: "x", targetType: "sage_conversation", targetId: "a-conversation" });
    copyOf(db, "SageMemory", "rl-", { subjectType: "teacher", subjectId: "gone-staff" });
    db.insert("GrantKpiSnapshot", { programYear: "2026", snapshotDate: new Date(0), classId: "gone-class", metrics: "{}", counts: "{}" });

    const { orphans } = countsOf(await preview(db)).leftBehind;

    assert.equal(orphans["AuditLog.actorId"], 1);
    assert.equal(orphans["AuditLog.targetId"], 1);
    assert.equal(orphans["SageMemory.subjectId"], 1);
    assert.equal(orphans["GrantKpiSnapshot.classId"], 1);
    assert.equal(total(orphans), 4);
  });

  it("starts at 0 on the seeded scene and reads 0 again in the preview after an apply", async () => {
    const { db } = await scene();
    assert.equal(total(countsOf(await preview(db)).leftBehind.orphans), 0);

    assert.equal((await apply(db)).kind, "applied");

    assert.equal(total(countsOf(await preview(db)).leftBehind.orphans), 0);
  });

  it("does not count the word system in an actor column as a missing account", async () => {
    const { db } = await scene();

    const { orphans } = countsOf(await preview(db)).leftBehind;

    assert.ok(db.rows("SageOperation").some((row) => row.actorId === "system"));
    assert.equal(orphans["SageOperation.actorId"], 0);
  });

  it("does not count the actors production writes that are not accounts: admin-key, system:..., deterministic", async () => {
    const { db } = await scene();
    db.insert("AuditLog", { action: "x", targetType: "student", actorId: "admin-key", targetId: "rl-student" });
    db.insert("AuditLog", { action: "x", targetType: "system_config", actorId: "system:sage-autopilot" });
    copyOf(db, "SageOperation", "rl-", { actorId: "system:sage-autopilot", actorType: "student" });
    copyOf(db, "WagerVerdict", "rl-", { resolvedBy: "deterministic" });

    const { orphans } = countsOf(await preview(db)).leftBehind;

    assert.equal(total(orphans), 0, JSON.stringify(orphans));
  });

  it("applies over orphans that were there before, and reports each column before and after", async () => {
    const { db } = await scene();
    // Sage keeps operations about students who were offboarded on purpose (schema, SageOperation).
    copyOf(db, "SageOperation", "rl-", { targetStudentId: "an-offboarded-student" });

    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind !== "applied") return;
    assert.deepEqual(outcome.orphans["SageOperation.targetStudentId"], { before: 1, after: 1 });
    assert.deepEqual(outcome.orphans["AuditLog.actorId"], { before: 0, after: 0 });
    assert.equal(Object.keys(outcome.orphans).length, Object.keys(outcome.preview.leftBehind.orphans).length);
  });
});

describe("demo closeout refusals found by counting orphans inside the apply", () => {
  const cases = [{
    name: "a row naming a missing account appears during the apply", code: "orphans_rose" as const,
    // Stands in for a row written late: it lands after the accounts are deleted, where no earlier check can see it.
    arrange: (db: FakeDb) => db.afterDeleteFrom("Student", () => void db.insert("AuditLog", { action: "x", targetType: "x", actorId: "a-deleted-account" })),
  }];
  for (const refusal of cases) {
    it(`refuses and changes nothing when ${refusal.name}`, async () => {
      const { db } = await scene();
      const before = db.snapshot();
      refusal.arrange(db);

      const outcome = await apply(db);

      assert.equal(outcome.kind, "refused");
      assert.deepEqual(outcome.refusals, [{ code: refusal.code, sentence: REFUSALS[refusal.code], count: 1 }]);
      assert.equal(db.snapshot(), before);
    });
  }
});

describe("demo closeout queued jobs", () => {
  it("deletes the jobs whose payload names a marked account, and keeps the others", async () => {
    const { db, demo, real } = await scene();
    db.insert("BackgroundJob", { id: "job-plain-text", type: "x", payload: "not json" });

    const previewed = countsOf(await preview(db));
    const outcome = await apply(db);

    assert.equal(previewed.rowsToDelete.BackgroundJob, 1);
    assert.equal(outcome.kind, "applied");
    const payloads = db.rows("BackgroundJob").map((row) => String(row.payload));
    assert.equal(payloads.some((payload) => payload.includes(demo.studentId)), false);
    assert.equal(payloads.some((payload) => payload.includes(real.studentId)), true);
    assert.ok(payloads.includes("not json"));
  });
});

describe("demo closeout jobs reached through the demo class and its wagers", () => {
  it("deletes jobs whose payload names the demo class, its scrape config or run, or a demo wager, and keeps the same for the other universe", async () => {
    const { db } = await scene();
    const jobs = (prefix: string, classId: string) => [
      { type: "scrape_jobs", payload: JSON.stringify({ configId: `${prefix}JobClassConfig`, scrapeRunId: `${prefix}JobScrapeRun` }) },
      { type: "scrape_jobs", payload: JSON.stringify({ scrapeRunId: `${prefix}JobScrapeRun` }) },
      { type: "wager_diagnosis", payload: JSON.stringify({ wagerId: `${prefix}Wager` }) },
      { type: "x", payload: JSON.stringify({ classId }) },
    ];
    const demoClass = db.rows("SpokesClass").find((row) => String(row.id).startsWith("dm-"))?.id;
    const realClass = db.rows("SpokesClass").find((row) => String(row.id).startsWith("rl-"))?.id;
    jobs("dm-", String(demoClass)).forEach((job, index) => db.insert("BackgroundJob", { id: `job-dm-${index}`, ...job }));
    jobs("rl-", String(realClass)).forEach((job, index) => db.insert("BackgroundJob", { id: `job-rl-${index}`, ...job }));

    const previewed = countsOf(await preview(db));
    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
    assert.equal(previewed.rowsToDelete.BackgroundJob, 1 + 4);
    const left = db.rows("BackgroundJob").map((row) => String(row.id));
    assert.deepEqual(left.filter((id) => id.startsWith("job-dm-")), []);
    assert.equal(left.filter((id) => id.startsWith("job-rl-")).length, 4);
  });
});

describe("demo closeout counts of what it leaves", () => {
  it("counts settings that hold a demo class id, staff notices about a demo student and listings mirrored from a demo lead", async () => {
    const { db, demo, real } = await scene();
    db.insert("SystemConfig", { key: "pilot_classes", value: JSON.stringify([demo.classId, real.classId]) });
    db.insert("SystemConfig", { key: "other_classes", value: JSON.stringify([real.classId]) });
    db.insert("Notification", { studentId: real.staffId, type: "x", title: "Needs attention", body: `${String(db.rows("Student").find((row) => row.id === demo.studentId)?.displayName)} has a new alert` });
    db.insert("Notification", { studentId: real.staffId, type: "x", title: "Needs attention", body: "Someone else has a new alert" });
    copyOf(db, "Opportunity", "rl-", { sourceJobLeadId: "dm-JobLead" });

    const { leftBehind } = countsOf(await preview(db));

    assert.equal(leftBehind.systemConfigNamingDemoClass, 1);
    assert.equal(leftBehind.staffNotificationsAboutDemoStudents, 1);
    assert.equal(leftBehind.opportunitiesFromDemoLeads, 1);
  });

  it("counts the storage folders of the planned accounts, never naming one", async () => {
    const { db } = await scene();
    copyOf(db, "FileUpload", "dm-", { storageKey: "dm-student/second.pdf" });
    copyOf(db, "FileUpload", "dm-", { storageKey: "dm-student/third.pdf" });

    const { leftBehind, uploadedFilesLeftInStorage } = countsOf(await preview(db));

    assert.equal(uploadedFilesLeftInStorage, 3);
    assert.equal(leftBehind.storageFoldersOfDemoAccounts, 2);
  });
});

describe("demo closeout audit records", () => {
  it("does not refuse audit rows about the demo's own chat, certification and appointment, which the plan deletes", async () => {
    const { db, demo } = await scene();
    const targets = { sage_conversation: "dm-Conversation", certification: "dm-Certification", appointment: "dm-Appointment" };
    for (const [targetType, targetId] of Object.entries(targets)) copyOf(db, "AuditLog", "dm-", { actorId: demo.staffId, targetType, targetId });

    const outcome = await apply(db);

    assert.deepEqual(outcome.refusals, []);
    assert.equal(outcome.kind, "applied");
    assert.equal(db.rows("AuditLog").some((row) => Object.values(targets).includes(String(row.targetId))), false);
  });

  it("writes the per-model counts, the files left, the newest migration and the unmarked actors to its own audit row", async () => {
    const { db, demo, real } = await scene();
    copyOf(db, "AuditLog", "rl-", { actorId: real.staffId, targetType: "student", targetId: demo.studentId });

    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
    if (outcome.kind !== "applied") return;
    const [entry] = db.rows("AuditLog").filter((row) => row.action === "demo.closeout");
    assert.deepEqual(JSON.parse(String(entry.metadata)), {
      accounts: 2, classes: 1, rows: total(outcome.deleted), rowsByModel: outcome.deleted,
      uploadedFilesLeftInStorage: 1, newestMigration: FAKE_MIGRATION, deletedAuditRowsWithUnmarkedActor: 1,
    });
  });
});
