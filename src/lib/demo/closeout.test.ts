/**
 * The demo closeout over an in-memory database (readiness H10).
 *
 * closeout.fixtures.ts supplies the database: it follows the schema's foreign
 * keys and delete rules, and rolls a transaction back when its callback
 * throws. Every test seeds two universes with one row in every student-linked
 * model: `dm-` is marked as demo, `rl-` is not. What only Postgres can show is
 * in closeout.db.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DELETE_STEPS,
  REFUSALS,
  markedDemoAccountsRule,
  runDemoCloseout,
  type AppliedCounts,
  type CloseoutOptions,
  type CloseoutOutcome,
  type CloseoutPreview,
  type RefusalCode,
  type SelectionRule,
} from "./closeout";
import { DEMO_CLASS_CODE, DEMO_INSTRUCTOR_LOGIN } from "./config";
import { FakeDb, LOCAL, MODELS, copyOf, scene, seedUniverse, type Scene } from "./closeout.fixtures";

const DEMO_OFF = {};
const DEMO_ON = { COHORT_DEMO_MODE: "true" };

const preview = (db: FakeDb, extra: Partial<CloseoutOptions> = {}): Promise<CloseoutOutcome> =>
  runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF, local: LOCAL, ...extra });
/** An apply that names the two marked accounts every scene starts with. */
const apply = (db: FakeDb, extra: Partial<CloseoutOptions> = {}): Promise<CloseoutOutcome> =>
  runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF, local: LOCAL, expectAccounts: 2, ...extra });

/** The counts of an outcome that has them. */
function countsOf(outcome: CloseoutOutcome): CloseoutPreview {
  assert.notEqual(outcome.kind, "unreadable");
  if (outcome.kind === "unreadable") throw new Error("unreachable");
  return outcome.preview;
}

/** What an apply deleted. Fails the test when the outcome is not an apply. */
function appliedOf(outcome: CloseoutOutcome): AppliedCounts {
  assert.equal(outcome.kind, "applied");
  if (outcome.kind !== "applied") throw new Error("unreachable");
  return outcome;
}

/** Rows anywhere in the database that hold one of these ids in any column. */
function rowsNaming(db: FakeDb, ids: readonly string[]): string[] {
  return MODELS.flatMap((model) =>
    db.rows(model.name)
      .filter((row) => Object.values(row).some((value) => typeof value === "string" && ids.includes(value)))
      .map(() => model.name));
}

function rowsOf(db: FakeDb, prefix: string): string {
  return JSON.stringify(MODELS.map((model) => [model.name, db.rows(model.name).filter((row) => JSON.stringify(row).includes(prefix))]));
}

/** A time the fake server's clock calls this many minutes ago. */
function minutesBefore(db: FakeDb, minutes: number): Date {
  return new Date(db.now.getTime() - minutes * 60_000);
}

function codes(outcome: CloseoutOutcome): RefusalCode[] {
  return outcome.refusals.map((refusal) => refusal.code);
}

describe("demo closeout preview", () => {
  it("counts the marked accounts, the demo class and the people it leaves alone", async () => {
    const { db } = await scene();

    const outcome = await preview(db);

    assert.equal(outcome.kind, "preview");
    assert.deepEqual(outcome.refusals, []);
    assert.deepEqual(countsOf(outcome).marked, { students: 1, instructors: 1, demoClasses: 1 });
    assert.equal(countsOf(outcome).unmarked.students, 1);
    assert.deepEqual(countsOf(outcome).unmarked.staffByRole, { teacher: 1, admin: 0, coordinator: 0, other: 0 });
    assert.equal(countsOf(outcome).unmarked.enrolledInDemoClass, 0);
    assert.equal(countsOf(outcome).unmarked.publicCredentialPages, 1);
    assert.equal(countsOf(outcome).demoModeOn, false);
    assert.equal(countsOf(outcome).realStudentDataDeclared, false);
    assert.equal(countsOf(outcome).rowsToDelete.Student, 2);
    assert.equal(countsOf(outcome).rowsToDelete.SpokesClass, 1);
    assert.equal(countsOf(outcome).rowsToDelete.AuditLog, 3);
    assert.equal(countsOf(outcome).rowsToDelete.SageOperation, 3);
    assert.equal(countsOf(outcome).rowsToDelete.SageMemoryEdge, 4);
  });

  it("is tested against a scene with a row to delete in every model a step names", async () => {
    const { db } = await scene();

    const { rowsToDelete } = countsOf(await preview(db));

    assert.deepEqual(DELETE_STEPS.map((step) => step.model).filter((model) => !(rowsToDelete[model] > 0)), []);
  });

  it("changes nothing", async () => {
    const { db } = await scene();
    const before = db.snapshot();

    await preview(db);

    assert.equal(db.snapshot(), before);
    assert.equal(db.writes, 0);
  });

  it("reports the two switches", async () => {
    const { db } = await scene();

    const outcome = await preview(db, { env: { COHORT_DEMO_MODE: "true", REAL_STUDENT_DATA: "true" } });

    assert.equal(countsOf(outcome).demoModeOn, true);
    assert.equal(countsOf(outcome).realStudentDataDeclared, true);
  });

  it("counts every row the apply then deletes, model by model", async () => {
    const { db } = await scene();

    const previewed = await preview(db);
    const applied = await apply(db);

    assert.deepEqual(appliedOf(applied).deleted, countsOf(previewed).rowsToDelete);
  });

  it("counts a row once when two accounts in different batches both name it", async () => {
    const { db } = await scene();

    const whole = await preview(db);
    const oneAtATime = await preview(db, { chunkSize: 1 });

    assert.deepEqual(countsOf(oneAtATime).rowsToDelete, countsOf(whole).rowsToDelete);
  });

  it("holds counts and fixed sentences only: no name, login, email or id", async () => {
    const { db, demo, real } = await scene();
    db.insert("Student", {
      id: "cm3x9k2p40000qwertyuiopas", studentId: "maria.gonzalez", displayName: "Maria Gonzalez",
      email: "maria.gonzalez@example.org", role: "student", demoAccount: null,
    });
    db.insert("StudentClassEnrollment", { classId: demo.classId, studentId: real.studentId });

    const outcome = await preview(db);
    const json = JSON.stringify(outcome);

    const leaves: unknown[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "object" && value !== null) Object.entries(value).forEach(([name, child]) => walk(child, `${path}.${name}`));
      else if (!/\.refusals\.\d+\.(code|sentence)$|^\.kind$|^\.target\.(database|serverAddress)$/.test(path)) leaves.push(value);
    };
    walk(outcome, "");
    assert.ok(leaves.length > 60);
    assert.deepEqual(leaves.filter((leaf) => typeof leaf !== "number" && typeof leaf !== "boolean"), []);
    assert.ok(outcome.refusals.length > 0);
    for (const refusal of outcome.refusals) assert.equal(refusal.sentence, REFUSALS[refusal.code]);
    const seeded = db.allStrings().filter((text) => /^(dm-|rl-)|@|maria|gonzalez/i.test(text));
    assert.ok(seeded.length > 100);
    assert.deepEqual(seeded.filter((text) => json.includes(text)), []);
    assert.doesNotMatch(json, /@|maria|gonzalez/i);
    assert.doesNotMatch(json, /\bc[a-z0-9]{24}\b/);
    assert.equal(json.includes(DEMO_INSTRUCTOR_LOGIN), false);
    assert.equal(json.includes(DEMO_CLASS_CODE), false);
  });
});

describe("demo closeout apply", () => {
  it("leaves no marked account and no row that names a deleted account or class", async () => {
    const { db, demo } = await scene();
    assert.ok(rowsNaming(db, [demo.studentId, demo.staffId, demo.classId]).length > 60);

    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
    assert.deepEqual(rowsNaming(db, [demo.studentId, demo.staffId, demo.classId]), []);
    assert.equal(db.rows("Student").filter((row) => row.demoAccount !== null).length, 0);
    assert.deepEqual(appliedOf(outcome).remaining, { markedAccounts: 0, rowsPointingAtDeleted: 0 });
  });

  it("leaves every unmarked row exactly as it was", async () => {
    const { db } = await scene();
    const before = rowsOf(db, "rl-");

    await apply(db);

    assert.equal(rowsOf(db, "rl-"), before);
  });

  it("keeps the shared program rows a demo account merely referenced", async () => {
    const { db } = await scene();

    await apply(db);

    for (const model of ["Employer", "EmployerContact", "Opportunity", "CareerEvent", "FormTemplate", "OrientationItem", "Pathway", "Region", "CertTemplate", "JobBrowseListing"]) {
      assert.equal(db.rows(model).filter((row) => row.id === `dm-${model}`).length, 1, model);
    }
  });

  it("deletes what belonged to the demo class, and nothing of another class", async () => {
    const { db } = await scene();

    await apply(db);

    for (const model of ["SpokesClass", "JobClassConfig", "JobListing", "JobScrapeRun", "JobScrapeSourceResult", "ClassRequirement", "JobLead"]) {
      assert.deepEqual(db.rows(model).map((row) => String(row.id).slice(0, 3)), ["rl-"], model);
    }
  });

  it("records the closeout in the audit log with counts only", async () => {
    const { db } = await scene();

    const outcome = await apply(db);

    const [entry, ...others] = db.rows("AuditLog").filter((row) => row.action === "demo.closeout");
    assert.equal(others.length, 0);
    assert.equal(entry.actorId, null);
    assert.equal(entry.targetId, null);
    const rows = Object.values(appliedOf(outcome).deleted).reduce((sum, count) => sum + count, 0);
    assert.ok(rows > 70);
    // The other keys are pinned in closeout.leftovers.test.ts.
    const { accounts, classes, rows: written } = JSON.parse(String(entry.metadata));
    assert.deepEqual({ accounts, classes, rows: written }, { accounts: 2, classes: 1, rows });
  });

  it("does nothing the second time", async () => {
    const { db } = await scene();
    await apply(db);
    const before = db.rows("AuditLog").length;

    const again = await apply(db, { expectAccounts: 0 });

    assert.equal(again.kind, "applied");
    assert.equal(Object.values(appliedOf(again).deleted).reduce((sum, count) => sum + count, 0), 0);
    assert.equal(db.rows("AuditLog").length, before + 1);
  });

  it("gives the same result when the ids go to the database one at a time", async () => {
    const whole = await scene();
    const split = await scene();

    const first = await apply(whole.db);
    const second = await apply(split.db, { chunkSize: 1 });

    assert.deepEqual(appliedOf(second).deleted, appliedOf(first).deleted);
    assert.equal(rowsOf(split.db, "dm-"), rowsOf(whole.db, "dm-"));
  });

  it("rolls everything back when a statement fails half way", async () => {
    const { db } = await scene();
    const before = db.snapshot();
    db.failOnDeleteOf = "Goal";

    await assert.rejects(apply(db), /Injected failure/);

    assert.equal(db.snapshot(), before);
  });
});

interface RefusalCase {
  name: string;
  code: RefusalCode;
  count: number;
  env?: Readonly<Record<string, string>>;
  rule?: (scene: Scene) => SelectionRule;
  /** How many accounts the rule's plan holds, when it is not the scene's two. */
  expectAccounts?: number;
  arrange?: (scene: Scene) => void;
}

const REFUSAL_CASES: readonly RefusalCase[] = [
  { name: "demo mode is on", code: "demo_mode_on", count: 1, env: DEMO_ON },
  {
    name: "an unmarked student is enrolled in the demo class", code: "unmarked_student_in_demo_class", count: 1,
    arrange: ({ db, demo, real }) => void db.insert("StudentClassEnrollment", { classId: demo.classId, studentId: real.studentId }),
  },
  {
    name: "an unmarked teacher is on the demo class", code: "unmarked_rows_on_demo_class", count: 1,
    arrange: ({ db, demo, real }) => void db.insert("SpokesClassInstructor", { classId: demo.classId, instructorId: real.staffId }),
  },
  {
    name: "an unmarked student's resume version is for a demo class job listing", code: "unmarked_rows_on_demo_class", count: 1,
    arrange: ({ db }) => void copyOf(db, "ResumeVersion", "rl-", { jobListingId: "dm-JobListing", jobLeadId: null }),
  },
  {
    name: "an unmarked student's connection is to a demo class job lead", code: "unmarked_rows_on_demo_class", count: 1,
    arrange: ({ db }) => void copyOf(db, "Connection", "rl-", { jobLeadId: "dm-JobLead" }),
  },
  {
    name: "a marked account teaches a class that has unmarked students", code: "marked_staff_over_unmarked_students", count: 1,
    arrange: ({ db, demo, real }) => void db.insert("SpokesClassInstructor", { classId: real.classId, instructorId: demo.staffId }),
  },
  {
    name: "a marked account coordinates a region that has unmarked students", code: "marked_staff_over_unmarked_students", count: 1,
    arrange: ({ db, demo, real }) => {
      db.insert("Region", { id: "rl-region-2", name: "rl-region-2", code: "rl-region-2" });
      db.insert("SpokesClass", { id: "rl-class-2", code: "rl-class-2", name: "rl-class-2", regionId: "rl-region-2" });
      db.insert("StudentClassEnrollment", { classId: "rl-class-2", studentId: real.studentId });
      db.insert("RegionCoordinator", { regionId: "rl-region-2", coordinatorId: demo.staffId });
    },
  },
  {
    name: "a marked account wrote a case note about an unmarked student", code: "marked_account_on_kept_rows", count: 1,
    arrange: ({ db, demo }) => void copyOf(db, "CaseNote", "rl-", { authorId: demo.staffId }),
  },
  {
    name: "a marked account created a shared opportunity", code: "marked_account_on_kept_rows", count: 1,
    arrange: ({ db, demo }) => void copyOf(db, "Opportunity", "rl-", { createdById: demo.staffId }),
  },
  {
    name: "a marked account assigned a form to an unmarked student", code: "marked_account_on_kept_rows", count: 1,
    arrange: ({ db, demo, real }) => void copyOf(db, "FormAssignment", "rl-", { assignedById: demo.staffId, targetId: real.studentId }),
  },
  {
    name: "a marked account is named, with no foreign key, on an unmarked student's row", code: "marked_account_on_kept_rows", count: 2,
    arrange: ({ db, demo }) => {
      copyOf(db, "SageInsight", "rl-", { dismissedBy: demo.staffId });
      copyOf(db, "CertRequirement", "rl-", { verifiedBy: demo.staffId });
    },
  },
  {
    name: "a marked account sent a chat message in the last 30 minutes", code: "demo_recently_active", count: 1,
    arrange: ({ db }) => void copyOf(db, "Message", "dm-", { createdAt: minutesBefore(db, 5) }),
  },
  {
    name: "a marked account's conversation changed and it acted on the audit log in the last 30 minutes", code: "demo_recently_active", count: 2,
    arrange: ({ db, demo }) => {
      copyOf(db, "Conversation", "dm-", { updatedAt: minutesBefore(db, 29) });
      copyOf(db, "AuditLog", "dm-", { actorId: demo.staffId, createdAt: minutesBefore(db, 1) });
    },
  },
  {
    name: "a marked account was created in the last 30 minutes", code: "demo_recently_active", count: 1, expectAccounts: 3,
    arrange: ({ db }) => void db.insert("Student", { id: "dm-late", studentId: "demo-dm-late", displayName: "dm late", role: "student", demoAccount: "student", createdAt: minutesBefore(db, 10) }),
  },
  {
    name: "a marked account's audit row is about an unmarked student", code: "records_about_unmarked_people", count: 1,
    arrange: ({ db, demo, real }) => void copyOf(db, "AuditLog", "dm-", { actorId: demo.staffId, targetType: "student", targetId: real.studentId }),
  },
  {
    name: "a marked account's audit row is about another class", code: "records_about_unmarked_people", count: 1,
    arrange: ({ db, demo, real }) => void copyOf(db, "AuditLog", "dm-", { actorId: demo.staffId, targetType: "class", targetId: real.classId }),
  },
  {
    // The demo instructor's routes log a row id as the target, not the student's.
    name: "a marked account's audit row is about an unmarked student's certification", code: "records_about_unmarked_people", count: 1,
    arrange: ({ db, demo }) => void copyOf(db, "AuditLog", "dm-", { actorId: demo.staffId, targetType: "certification", targetId: "rl-Certification" }),
  },
  {
    name: "a marked account's audit row is about an unmarked student's appointment", code: "records_about_unmarked_people", count: 1,
    arrange: ({ db, demo }) => void copyOf(db, "AuditLog", "dm-", { actorId: demo.staffId, targetType: "appointment", targetId: "rl-Appointment" }),
  },
  {
    name: "a marked account's audit row names a target no step deletes", code: "records_about_unmarked_people", count: 1,
    arrange: ({ db, demo }) => void copyOf(db, "AuditLog", "dm-", { actorId: demo.studentId, targetType: "sage_conversation", targetId: "a-conversation-the-plan-keeps" }),
  },
  {
    name: "a marked account's Sage operation is about an unmarked student", code: "records_about_unmarked_people", count: 1,
    arrange: ({ db, demo, real }) => void copyOf(db, "SageOperation", "dm-", { actorId: demo.staffId, targetStudentId: real.studentId }),
  },
  {
    name: "a message to a marked account is on an unmarked student's connection", code: "records_about_unmarked_people", count: 1,
    arrange: ({ db, demo }) => void copyOf(db, "OutboundMessage", "rl-", { toId: demo.staffId, connectionId: "rl-Connection" }),
  },
  {
    name: "an unmarked student's task would lose its link to a demo appointment", code: "kept_rows_would_be_blanked", count: 1,
    arrange: ({ db }) => void copyOf(db, "StudentTask", "rl-", { appointmentId: "dm-Appointment" }),
  },
  {
    name: "the plan holds an account that is not marked", code: "plan_includes_unmarked", count: 1, expectAccounts: 1,
    rule: ({ real }) => async () => ({ accountIds: [real.studentId], classIds: [] }),
  },
  {
    name: "a row would be left naming a deleted account", code: "rows_left_pointing", count: 1, expectAccounts: 1,
    // The plan is a marked subset: the marked teacher stays, with a goal that names the deleted student.
    rule: ({ demo }) => async () => ({ accountIds: [demo.studentId], classIds: [] }),
    // SageInsight.dismissedBy has no foreign key, so no check before the deletes sees it.
    arrange: ({ db, demo }) => void copyOf(db, "SageInsight", "dm-", { studentId: demo.staffId, dismissedBy: demo.studentId }),
  },
  {
    name: "a cascade would remove a row the plan does not list", code: "unlisted_rows_removed", count: 1,
    arrange: ({ db }) => void copyOf(db, "GoalResourceLink", "rl-", { goalId: "dm-Goal" }),
  },
];

/** Refusals whose "refuses and changes nothing" case lives in another test file. */
const REFUSALS_TESTED_ELSEWHERE: Readonly<Partial<Record<RefusalCode, string>>> = {
  cannot_see_every_row: "closeout.server.test.ts",
  schema_mismatch: "closeout.server.test.ts",
  expected_accounts_mismatch: "closeout.server.test.ts",
  demo_recently_active: "closeout.server.test.ts",
  orphans_rose: "closeout.leftovers.test.ts",
};

describe("demo closeout refusals", () => {
  for (const refusal of REFUSAL_CASES) {
    it(`refuses and changes nothing when ${refusal.name}`, async () => {
      const staged = await scene();
      refusal.arrange?.(staged);
      const before = staged.db.snapshot();
      const options = { env: refusal.env ?? DEMO_OFF, rule: refusal.rule?.(staged), expectAccounts: refusal.expectAccounts ?? 2 };

      const outcome = await apply(staged.db, options);

      assert.equal(outcome.kind, "refused");
      assert.equal("deleted" in outcome, false);
      assert.deepEqual(outcome.refusals.filter((entry) => entry.code === refusal.code),
        [{ code: refusal.code, sentence: REFUSALS[refusal.code], count: refusal.count }]);
      assert.equal(staged.db.snapshot(), before);
    });
  }

  it("refuses when a class holds the demo code but the marked demo instructor does not own it", async () => {
    const db = new FakeDb();
    const real = await seedUniverse(async (model, data) => void db.insert(model, data), { prefix: "rl-", demo: false });
    db.insert("SpokesClass", { id: "rl-lookalike", code: DEMO_CLASS_CODE, name: "Cohort Demo", createdById: real.staffId });
    const before = db.snapshot();

    const outcome = await apply(db, { expectAccounts: 0 });

    assert.deepEqual(outcome.refusals, [{ code: "demo_class_not_owned", sentence: REFUSALS.demo_class_not_owned, count: 1 }]);
    assert.equal(db.snapshot(), before);
  });

  it("has a case that refuses and changes nothing for every refusal, here or in the file named", () => {
    const here = new Set<string>([...REFUSAL_CASES.map((refusal) => refusal.code), "demo_class_not_owned"]);
    const elsewhere = Object.entries(REFUSALS_TESTED_ELSEWHERE).filter(([code, file]) => {
      const text = readFileSync(path.join(__dirname, file), "utf8");
      return text.includes(`code: "${code}"`) && text.includes("refuses and changes nothing when");
    }).map(([code]) => code);

    assert.deepEqual(Object.keys(REFUSALS).filter((code) => !here.has(code) && !elsewhere.includes(code)), []);
  });

  it("writes every refusal as one plain sentence that says nothing was deleted", () => {
    for (const sentence of Object.values(REFUSALS)) {
      assert.match(sentence, /Nothing was deleted\.$/);
      assert.doesNotMatch(sentence, /[‒-―]| - /);
    }
  });

  it("lists in the preview every refusal it can see without writing", async () => {
    const staged = await scene();
    staged.db.insert("StudentClassEnrollment", { classId: staged.demo.classId, studentId: staged.real.studentId });

    const outcome = await preview(staged.db, { env: DEMO_ON });

    assert.equal(outcome.kind, "preview");
    assert.deepEqual(codes(outcome), ["demo_mode_on", "unmarked_student_in_demo_class"]);
    assert.equal(countsOf(outcome).unmarked.enrolledInDemoClass, 1);
  });

  it("selects every marked account and only the demo class its instructor owns", async () => {
    const { db, demo, real } = await scene();
    db.insert("SpokesClass", { id: "dm-second", code: "dm-second", name: "dm-second", createdById: demo.staffId });
    const plan = await db.client().$transaction((tx) => markedDemoAccountsRule(tx));

    assert.deepEqual([...plan.accountIds].sort(), [demo.staffId, demo.studentId].sort());
    assert.deepEqual(plan.classIds, [demo.classId]);
    assert.equal(plan.accountIds.includes(real.studentId), false);
  });
});
