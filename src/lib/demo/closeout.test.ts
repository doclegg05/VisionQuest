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
import { describe, it } from "node:test";
import {
  DELETE_STEPS,
  REFUSALS,
  markedDemoAccountsRule,
  runCloseoutCommand,
  runDemoCloseout,
  type CloseoutOutcome,
  type RefusalCode,
  type SelectionRule,
} from "./closeout";
import { DEMO_CLASS_CODE, DEMO_INSTRUCTOR_LOGIN } from "./config";
import { FakeDb, MODELS, seedUniverse, type Row, type SeededUniverse } from "./closeout.fixtures";

const DEMO_OFF = {};
const DEMO_ON = { COHORT_DEMO_MODE: "true" };
/** Built from parts so no scanner reads this file as holding a credential. It is not a real one. */
const PASSWORD = ["not", "a", "real", "password"].join("-");
const URL = ["postgresql://owner:", PASSWORD, "@db.example.test:5432/visionquest"].join("");

interface Scene {
  db: FakeDb;
  demo: SeededUniverse;
  real: SeededUniverse;
}

async function scene(): Promise<Scene> {
  const db = new FakeDb();
  const write = async (model: string, data: Row) => void db.insert(model, data);
  const demo = await seedUniverse(write, { prefix: "dm-", demo: true });
  const real = await seedUniverse(write, { prefix: "rl-", demo: false });
  return { db, demo, real };
}

/** A copy of the universe's own row of `model`, with some columns changed. */
function copyOf(db: FakeDb, model: string, prefix: string, changes: Row): Row {
  const original = db.rows(model).find((row) => JSON.stringify(row).includes(prefix));
  assert.ok(original, `the ${prefix} universe has no ${model} row`);
  return db.insert(model, { ...original, id: `${prefix}${model}.copy`, ...changes });
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

function codes(outcome: CloseoutOutcome): RefusalCode[] {
  return outcome.refusals.map((refusal) => refusal.code);
}

describe("demo closeout preview", () => {
  it("counts the marked accounts, the demo class and the people it leaves alone", async () => {
    const { db } = await scene();

    const outcome = await runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF });

    assert.equal(outcome.kind, "preview");
    assert.deepEqual(outcome.refusals, []);
    assert.deepEqual(outcome.preview.marked, { students: 1, instructors: 1, demoClasses: 1 });
    assert.equal(outcome.preview.unmarked.students, 1);
    assert.deepEqual(outcome.preview.unmarked.staffByRole, { teacher: 1, admin: 0, coordinator: 0, other: 0 });
    assert.equal(outcome.preview.unmarked.enrolledInDemoClass, 0);
    assert.equal(outcome.preview.unmarked.publicCredentialPages, 1);
    assert.equal(outcome.preview.demoModeOn, false);
    assert.equal(outcome.preview.realStudentDataDeclared, false);
    assert.equal(outcome.preview.rowsToDelete.Student, 2);
    assert.equal(outcome.preview.rowsToDelete.SpokesClass, 1);
    assert.equal(outcome.preview.rowsToDelete.AuditLog, 3);
    assert.equal(outcome.preview.rowsToDelete.SageOperation, 3);
    assert.equal(outcome.preview.rowsToDelete.SageMemoryEdge, 4);
  });

  it("is tested against a scene with a row to delete in every model a step names", async () => {
    const { db } = await scene();

    const { preview } = await runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF });

    assert.deepEqual(DELETE_STEPS.map((step) => step.model).filter((model) => !(preview.rowsToDelete[model] > 0)), []);
  });

  it("changes nothing", async () => {
    const { db } = await scene();
    const before = db.snapshot();

    await runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF });

    assert.equal(db.snapshot(), before);
    assert.equal(db.writes, 0);
  });

  it("reports the two switches", async () => {
    const { db } = await scene();

    const outcome = await runDemoCloseout(db.client(), { apply: false, env: { COHORT_DEMO_MODE: "true", REAL_STUDENT_DATA: "true" } });

    assert.equal(outcome.preview.demoModeOn, true);
    assert.equal(outcome.preview.realStudentDataDeclared, true);
  });

  it("counts every row the apply then deletes, model by model", async () => {
    const { db } = await scene();

    const preview = await runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF });
    const applied = await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    assert.equal(applied.kind, "applied");
    assert.deepEqual(applied.deleted, preview.preview.rowsToDelete);
  });

  it("counts a row once when two accounts in different batches both name it", async () => {
    const { db } = await scene();

    const whole = await runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF });
    const oneAtATime = await runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF, chunkSize: 1 });

    assert.deepEqual(oneAtATime.preview.rowsToDelete, whole.preview.rowsToDelete);
  });

  it("holds counts and fixed sentences only: no name, login, email or id", async () => {
    const { db, demo, real } = await scene();
    db.insert("Student", {
      id: "cm3x9k2p40000qwertyuiopas", studentId: "maria.gonzalez", displayName: "Maria Gonzalez",
      email: "maria.gonzalez@example.org", role: "student", demoAccount: null,
    });
    db.insert("StudentClassEnrollment", { classId: demo.classId, studentId: real.studentId });

    const outcome = await runDemoCloseout(db.client(), { apply: false, env: DEMO_OFF });
    const json = JSON.stringify(outcome);

    const leaves: unknown[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "object" && value !== null) Object.entries(value).forEach(([name, child]) => walk(child, `${path}.${name}`));
      else if (!/\.refusals\.\d+\.(code|sentence)$|^\.kind$/.test(path)) leaves.push(value);
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

    const outcome = await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    assert.equal(outcome.kind, "applied");
    assert.deepEqual(rowsNaming(db, [demo.studentId, demo.staffId, demo.classId]), []);
    assert.equal(db.rows("Student").filter((row) => row.demoAccount !== null).length, 0);
    assert.deepEqual(outcome.remaining, { markedAccounts: 0, rowsPointingAtDeleted: 0 });
  });

  it("leaves every unmarked row exactly as it was", async () => {
    const { db } = await scene();
    const before = rowsOf(db, "rl-");

    await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    assert.equal(rowsOf(db, "rl-"), before);
  });

  it("keeps the shared program rows a demo account merely referenced", async () => {
    const { db } = await scene();

    await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    for (const model of ["Employer", "EmployerContact", "Opportunity", "CareerEvent", "FormTemplate", "OrientationItem", "Pathway", "Region", "CertTemplate", "JobBrowseListing"]) {
      assert.equal(db.rows(model).filter((row) => row.id === `dm-${model}`).length, 1, model);
    }
  });

  it("deletes what belonged to the demo class, and nothing of another class", async () => {
    const { db } = await scene();

    await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    for (const model of ["SpokesClass", "JobClassConfig", "JobListing", "JobScrapeRun", "JobScrapeSourceResult", "ClassRequirement", "JobLead"]) {
      assert.deepEqual(db.rows(model).map((row) => String(row.id).slice(0, 3)), ["rl-"], model);
    }
  });

  it("records the closeout in the audit log with counts only", async () => {
    const { db } = await scene();

    const outcome = await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    const [entry, ...others] = db.rows("AuditLog").filter((row) => row.action === "demo.closeout");
    assert.equal(others.length, 0);
    assert.equal(entry.actorId, null);
    assert.equal(entry.targetId, null);
    const rows = Object.values(outcome.deleted ?? {}).reduce((sum, count) => sum + count, 0);
    assert.ok(rows > 70);
    assert.deepEqual(JSON.parse(String(entry.metadata)), { accounts: 2, classes: 1, rows });
  });

  it("does nothing the second time", async () => {
    const { db } = await scene();
    await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });
    const before = db.rows("AuditLog").length;

    const again = await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    assert.equal(again.kind, "applied");
    assert.equal(Object.values(again.deleted ?? {}).reduce((sum, count) => sum + count, 0), 0);
    assert.equal(db.rows("AuditLog").length, before + 1);
  });

  it("gives the same result when the ids go to the database one at a time", async () => {
    const whole = await scene();
    const split = await scene();

    const first = await runDemoCloseout(whole.db.client(), { apply: true, env: DEMO_OFF });
    const second = await runDemoCloseout(split.db.client(), { apply: true, env: DEMO_OFF, chunkSize: 1 });

    assert.deepEqual(second.deleted, first.deleted);
    assert.equal(rowsOf(split.db, "dm-"), rowsOf(whole.db, "dm-"));
  });

  it("rolls everything back when a statement fails half way", async () => {
    const { db } = await scene();
    const before = db.snapshot();
    db.failOnDeleteOf = "Goal";

    await assert.rejects(runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF }), /Injected failure/);

    assert.equal(db.snapshot(), before);
  });
});

interface RefusalCase {
  name: string;
  code: RefusalCode;
  count: number;
  env?: Readonly<Record<string, string>>;
  rule?: (scene: Scene) => SelectionRule;
  arrange?: (scene: Scene) => void;
}

const REFUSAL_CASES: readonly RefusalCase[] = [
  { name: "demo mode is on", code: "demo_mode_on", count: 1, env: DEMO_ON },
  {
    name: "the connection is limited by row level security", code: "cannot_see_every_row", count: 1,
    arrange: ({ db }) => { db.bypassesRls = false; },
  },
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
    name: "the plan holds an account that is not marked", code: "plan_includes_unmarked", count: 1,
    rule: ({ real }) => async () => ({ accountIds: [real.studentId], classIds: [] }),
  },
  {
    name: "a row would be left naming a deleted account", code: "rows_left_pointing", count: 1,
    // The plan is a marked subset: the marked teacher stays, with a goal that names the deleted student.
    rule: ({ demo }) => async () => ({ accountIds: [demo.studentId], classIds: [] }),
    arrange: ({ db, demo }) => void copyOf(db, "Goal", "dm-", { studentId: demo.staffId, confirmedBy: demo.studentId, parentId: null }),
  },
  {
    name: "a cascade would remove a row the plan does not list", code: "unlisted_rows_removed", count: 1,
    arrange: ({ db }) => void copyOf(db, "GoalResourceLink", "rl-", { goalId: "dm-Goal" }),
  },
];

describe("demo closeout refusals", () => {
  for (const refusal of REFUSAL_CASES) {
    it(`refuses and changes nothing when ${refusal.name}`, async () => {
      const staged = await scene();
      refusal.arrange?.(staged);
      const before = staged.db.snapshot();
      const options = { env: refusal.env ?? DEMO_OFF, rule: refusal.rule?.(staged) };

      const outcome = await runDemoCloseout(staged.db.client(), { ...options, apply: true });

      assert.equal(outcome.kind, "refused");
      assert.equal(outcome.deleted, undefined);
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

    const outcome = await runDemoCloseout(db.client(), { apply: true, env: DEMO_OFF });

    assert.deepEqual(outcome.refusals, [{ code: "demo_class_not_owned", sentence: REFUSALS.demo_class_not_owned, count: 1 }]);
    assert.equal(db.snapshot(), before);
  });

  it("has a case for every refusal", () => {
    const covered = new Set<string>([...REFUSAL_CASES.map((refusal) => refusal.code), "demo_class_not_owned"]);

    assert.deepEqual(Object.keys(REFUSALS).filter((code) => !covered.has(code)), []);
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

    const outcome = await runDemoCloseout(staged.db.client(), { apply: false, env: DEMO_ON });

    assert.equal(outcome.kind, "preview");
    assert.deepEqual(codes(outcome), ["demo_mode_on", "unmarked_student_in_demo_class"]);
    assert.equal(outcome.preview.unmarked.enrolledInDemoClass, 1);
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

describe("demo closeout command", () => {
  const command = (db: FakeDb, argv: string[], env: Readonly<Record<string, string>> = { ADMIN_DATABASE_URL: URL }) => {
    const opened: string[] = [];
    const result = runCloseoutCommand(argv, env, (url) => { opened.push(url); return db.client(); });
    return { opened, result };
  };

  it("previews by default and exits 0", async () => {
    const { db } = await scene();
    const before = db.snapshot();

    const { opened, result } = command(db, []);
    const { exitCode, stdout, stderr } = await result;

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.equal(JSON.parse(stdout.join("\n")).kind, "preview");
    assert.deepEqual(opened, [URL]);
    assert.equal(db.snapshot(), before);
    assert.equal(db.disconnects, 1);
  });

  it("applies with both flags and exits 0", async () => {
    const { db } = await scene();

    const { exitCode, stdout } = await command(db, ["--apply", "--confirm-demo-disabled"]).result;

    assert.equal(exitCode, 0);
    assert.equal(JSON.parse(stdout.join("\n")).kind, "applied");
    assert.equal(db.rows("Student").filter((row) => row.demoAccount !== null).length, 0);
  });

  for (const argv of [["--apply"], ["--force"], ["--apply", "--confirm-demo-disabled", "--skip-checks"], ["apply"], [URL]]) {
    it(`refuses the arguments ${JSON.stringify(argv).replace(URL, "<a database URL>")} with exit 2 and never connects`, async () => {
      const { db } = await scene();
      const before = db.snapshot();

      const { opened, result } = command(db, argv);
      const { exitCode, stdout, stderr } = await result;

      assert.equal(exitCode, 2);
      assert.deepEqual(stdout, []);
      assert.match(stderr.join("\n"), /^Refused: /);
      assert.equal(stderr.join("\n").includes(PASSWORD), false);
      assert.deepEqual(opened, []);
      assert.equal(db.transactions, 0);
      assert.equal(db.snapshot(), before);
    });
  }

  it("refuses with exit 2 when ADMIN_DATABASE_URL is missing", async () => {
    const { db } = await scene();

    const { opened, result } = command(db, [], {});

    assert.equal((await result).exitCode, 2);
    assert.deepEqual(opened, []);
  });

  it("refuses an apply while demo mode is on, before it connects", async () => {
    const { db } = await scene();

    const { opened, result } = command(db, ["--apply", "--confirm-demo-disabled"], { ADMIN_DATABASE_URL: URL, COHORT_DEMO_MODE: "true" });
    const { exitCode, stderr } = await result;

    assert.equal(exitCode, 2);
    assert.deepEqual(stderr, [`Refused: ${REFUSALS.demo_mode_on}`]);
    assert.deepEqual(opened, []);
  });

  it("exits 2 with the fixed sentence and its count when the apply is refused", async () => {
    const { db, demo, real } = await scene();
    db.insert("StudentClassEnrollment", { classId: demo.classId, studentId: real.studentId });
    const before = db.snapshot();

    const { exitCode, stderr } = await command(db, ["--apply", "--confirm-demo-disabled"]).result;

    assert.equal(exitCode, 2);
    assert.deepEqual(stderr, [`Refused: ${REFUSALS.unmarked_student_in_demo_class} (count: 1)`]);
    assert.equal(db.snapshot(), before);
  });

  it("exits 1 with one fixed sentence when the database fails, and prints none of the error", async () => {
    const { db } = await scene();
    db.failOnDeleteOf = "Goal";
    const before = db.snapshot();

    const { exitCode, stdout, stderr } = await command(db, ["--apply", "--confirm-demo-disabled"]).result;

    assert.equal(exitCode, 1);
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, ["Demo closeout failed. The transaction was rolled back, so nothing was deleted. Check that the database is reachable, then run the preview again."]);
    assert.equal(db.snapshot(), before);
    assert.equal(db.disconnects, 1);
  });

  it("never prints the database URL, even when connecting throws an error that quotes it", async () => {
    const result = await runCloseoutCommand([], { ADMIN_DATABASE_URL: URL }, () => {
      throw new Error(`Can't reach database server at ${URL}`);
    });

    assert.equal(result.exitCode, 1);
    assert.equal(JSON.stringify(result).includes(PASSWORD), false);
    assert.equal(JSON.stringify(result).includes("db.example.test"), false);
  });

  it("prints usage for --help and connects to nothing", async () => {
    const { db } = await scene();

    const { opened, result } = command(db, ["--help"]);
    const { exitCode, stdout } = await result;

    assert.equal(exitCode, 0);
    assert.match(stdout.join("\n"), /--apply --confirm-demo-disabled/);
    assert.match(stdout.join("\n"), /ADMIN_DATABASE_URL/);
    assert.deepEqual(opened, []);
  });
});
