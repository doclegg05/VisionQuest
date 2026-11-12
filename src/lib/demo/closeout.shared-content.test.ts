/**
 * Demo closeout (readiness H10e): audit rows about shared content.
 *
 * A demo student can register for a real career event, update an application
 * on a real opportunity or save a real job listing, and the demo instructor
 * could export a real form template's responses. Each writes an audit row
 * whose target is content the closeout keeps, so the refusal
 * `records_about_unmarked_people` would never clear. The closeout keeps those
 * rows and replaces the demo account's id with CLOSED_DEMO_ACTOR. Any other
 * row about kept content still refuses.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDemoCloseout, type CloseoutOutcome } from "./closeout";
import { FakeDb, LOCAL, copyOf, scene, type Row, type Scene } from "./closeout.fixtures";
import { previewLines } from "./closeout.report";
import { CLOSED_DEMO_ACTOR, SHARED_CONTENT_RECORDS } from "./closeout.shared-content";

const KEPT_LINE = (count: number) =>
  `${count} audit rows record a demo account acting on shared content, such as signing up for a real event. They stay. The demo account's id on them becomes ${CLOSED_DEMO_ACTOR}.`;

const preview = (db: FakeDb): Promise<CloseoutOutcome> => runDemoCloseout(db.client(), { apply: false, env: {}, local: LOCAL });
const apply = (db: FakeDb): Promise<CloseoutOutcome> => runDemoCloseout(db.client(), { apply: true, env: {}, local: LOCAL, expectAccounts: 2 });

const codes = (outcome: CloseoutOutcome) => outcome.refusals.map((entry) => `${entry.code}:${entry.count}`);

/** An audit row the demo universe wrote, about a row of the real universe. */
function auditRow(db: FakeDb, actorId: string, action: string, targetType: string, targetId: string): Row {
  return copyOf(db, "AuditLog", "dm-", { actorId, action, targetType, targetId, createdAt: new Date(0) });
}

const studentCases = (s: Scene) => [
  { action: "event.registered", targetType: "event", targetId: "rl-CareerEvent" },
  { action: "event.unregistered", targetType: "event", targetId: "rl-CareerEvent" },
  { action: "application.updated", targetType: "opportunity", targetId: "rl-Opportunity" },
  { action: "job.save", targetType: "JobBrowseListing", targetId: `${s.real.prefix}JobBrowseListing` },
];

describe("demo closeout: audit rows about shared content", () => {
  it("names each shared kind once, with the actions and the demo account kind that may write it", () => {
    const pairs = SHARED_CONTENT_RECORDS.flatMap((entry) => entry.actions.map((action) => `${entry.actor} ${action} ${entry.targetType}`));
    assert.deepEqual(pairs.sort(), [
      "instructor teacher.form.export form_template",
      "student application.updated opportunity",
      "student event.registered event",
      "student event.unregistered event",
      "student job.save JobBrowseListing",
    ]);
  });

  for (const index of [0, 1, 2, 3]) {
    it(`keeps a demo student's row about real shared content (case ${index + 1}) and removes the student's id from it`, async () => {
      const s = await scene();
      const wanted = studentCases(s)[index];
      const row = auditRow(s.db, s.demo.studentId, wanted.action, wanted.targetType, wanted.targetId);

      const previewed = await preview(s.db);
      assert.deepEqual(codes(previewed), [], `${wanted.action}`);
      const outcome = await apply(s.db);

      assert.equal(outcome.kind, "applied", codes(outcome).join(", "));
      const kept = s.db.rows("AuditLog").find((entry) => entry.id === row.id);
      assert.ok(kept, "the audit row must survive");
      assert.deepEqual(kept, { ...row, actorId: CLOSED_DEMO_ACTOR });
    });
  }

  it("keeps the demo instructor's form export row about a real form template", async () => {
    const s = await scene();
    const row = auditRow(s.db, s.demo.staffId, "teacher.form.export", "form_template", "rl-FormTemplate");

    const outcome = await apply(s.db);

    assert.equal(outcome.kind, "applied", codes(outcome).join(", "));
    assert.equal(s.db.rows("AuditLog").find((entry) => entry.id === row.id)?.actorId, CLOSED_DEMO_ACTOR);
  });

  it("does not count the kept rows as orphans, before or after the apply", async () => {
    const s = await scene();
    auditRow(s.db, s.demo.studentId, "event.registered", "event", "rl-CareerEvent");
    const before = await preview(s.db);

    assert.equal((await apply(s.db)).kind, "applied");
    const after = await preview(s.db);

    assert.ok(before.kind === "preview" && after.kind === "preview");
    assert.equal(after.preview.leftBehind.orphans["AuditLog.actorId"], before.preview.leftBehind.orphans["AuditLog.actorId"]);
  });

  it("says in the preview how many rows stay, and leaves them out of the rows to delete", async () => {
    const s = await scene();
    const plain = await preview(s.db);
    auditRow(s.db, s.demo.studentId, "event.registered", "event", "rl-CareerEvent");
    auditRow(s.db, s.demo.staffId, "teacher.form.export", "form_template", "rl-FormTemplate");

    const outcome = await preview(s.db);

    assert.ok(plain.kind === "preview" && outcome.kind === "preview");
    assert.equal(outcome.preview.leftBehind.auditRowsKeptAboutSharedContent, 2);
    assert.equal(outcome.preview.rowsToDelete.AuditLog, plain.preview.rowsToDelete.AuditLog);
  });

  it("prints how many audit rows stay, and why, in the preview's sentences", async () => {
    const s = await scene();
    auditRow(s.db, s.demo.studentId, "event.registered", "event", "rl-CareerEvent");
    auditRow(s.db, s.demo.studentId, "job.save", "JobBrowseListing", "rl-JobBrowseListing");

    const outcome = await preview(s.db);

    assert.ok(outcome.kind === "preview");
    const lines = previewLines(outcome.preview, outcome.refusals);
    assert.ok(lines.includes(KEPT_LINE(2)), lines.join("\n"));
    assert.equal(previewLines({ ...outcome.preview, leftBehind: { ...outcome.preview.leftBehind, auditRowsKeptAboutSharedContent: 0 } }, []).some((line) => line.includes("audit row")), false);
  });

  const refused: ReadonlyArray<{ name: string; arrange: (s: Scene) => void }> = [
    { name: "the demo instructor edited a real career event", arrange: (s) => void auditRow(s.db, s.demo.staffId, "event.updated", "event", "rl-CareerEvent") },
    { name: "the demo instructor wrote a student action about a real event", arrange: (s) => void auditRow(s.db, s.demo.staffId, "event.registered", "event", "rl-CareerEvent") },
    { name: "a demo student wrote a form export row", arrange: (s) => void auditRow(s.db, s.demo.studentId, "teacher.form.export", "form_template", "rl-FormTemplate") },
    { name: "a demo student saved a class job listing the plan keeps", arrange: (s) => void auditRow(s.db, s.demo.studentId, "job.save", "JobListing", "rl-JobListing") },
    { name: "a demo student's row names a shared kind under another action", arrange: (s) => void auditRow(s.db, s.demo.studentId, "opportunity.created", "opportunity", "rl-Opportunity") },
  ];
  for (const entry of refused) {
    it(`still refuses, and changes nothing, when ${entry.name}`, async () => {
      const s = await scene();
      entry.arrange(s);
      const before = s.db.snapshot();

      const outcome = await apply(s.db);

      assert.equal(outcome.kind, "refused");
      assert.deepEqual(codes(outcome), ["records_about_unmarked_people:1"]);
      assert.equal(s.db.snapshot(), before);
    });
  }
});
