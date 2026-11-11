/**
 * The demo closeout against a real Postgres (readiness H10).
 *
 * closeout.test.ts proves the rules over an in-memory database that follows
 * the schema's delete rules. What only a database can show is that the real
 * foreign keys agree with that model: that every explicit delete runs in an
 * order Postgres accepts, that no cascade takes a row the plan did not list,
 * that a refusal or a failure after deletes have run really rolls them back,
 * and that the preview's counts are the rows the apply removes.
 *
 * It seeds two universes with closeout.fixtures.ts, one marked as demo and one
 * not, each with a row in every model below Student and SpokesClass that the
 * database accepts, then runs the closeout through the same `runDemoCloseout`
 * the owner's script calls.
 *
 * Prerequisites (auto-skipped when missing):
 *   - DATABASE_URL points at a migrated, NON-PRODUCTION Postgres, as a role
 *     that bypasses row level security.
 *   - DEMO_CLOSEOUT_DB_TEST_ENABLED=true. Opt-in because the closeout deletes
 *     every marked demo account in the database, not only this test's.
 *
 * Two locks keep it off a real database even when the flag is set: the host
 * must be this machine, and the database must hold no demo account before the
 * test seeds its own.
 *
 * Postgres stamps every seeded row with the current time, which the closeout
 * reads as a demo still in use. `backdate` moves the demo universe's times two
 * hours back, so only the case that tests that refusal sees a recent row.
 *
 * Typical usage:
 *   DEMO_CLOSEOUT_DB_TEST_ENABLED=true DATABASE_URL=postgres://...test... \
 *     node --import tsx --test src/lib/demo/closeout.db.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import path from "node:path";
import { REFUSALS, runDemoCloseout, tableOf, type CloseoutClient, type CloseoutOptions, type CloseoutOutcome, type CloseoutTx, type RefusalCode } from "./closeout";
import { MODELS, seedUniverse, type Row, type SeededUniverse } from "./closeout.fixtures";
import { readLocalSchema } from "./closeout.local";

const SHOULD_RUN = process.env.DEMO_CLOSEOUT_DB_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;
const DEMO_OFF = {};
const ROOT = path.resolve(__dirname, "../../..");
/** The closeout as the owner's script runs it: against this checkout's schema. */
const closeout = (
  client: CloseoutClient,
  options: Omit<CloseoutOptions, "local" | "env"> & { env?: Record<string, string>; local?: CloseoutOptions["local"] },
): Promise<CloseoutOutcome> => runDemoCloseout(client, { local: readLocalSchema(ROOT), ...options, env: options.env ?? DEMO_OFF });
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Models whose row the test will not go without: the proof means little if these were not seeded. */
const MUST_SEED = ["Conversation", "Message", "Goal", "FileUpload", "SpokesRecord", "Connection", "CaseNote", "StudentClassEnrollment", "AuditLog", "SageMemory"];

/** True only for a URL whose host is this machine and that names no other host in its query. */
function isLocalDatabase(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return LOCAL_HOSTS.has(url.hostname) && !url.searchParams.has("host");
  } catch {
    return false;
  }
}

if (!SHOULD_RUN) {
  describe("demo closeout against Postgres (integration): SKIPPED", () => {
    it("requires DEMO_CLOSEOUT_DB_TEST_ENABLED=true and DATABASE_URL", () => {
      assert.ok(true, "Set DEMO_CLOSEOUT_DB_TEST_ENABLED=true and point DATABASE_URL at a local, migrated, empty test database.");
    });
  });
} else {
  describe("demo closeout against Postgres (integration)", () => {
    /** Undefined until `before` connects, so `after` can tell a failed start from a finished run. */
    let connected: PrismaClient | undefined;
    const db = (): PrismaClient => {
      if (!connected) throw new Error("The test database is not connected.");
      return connected;
    };
    let run = 0;
    let demo: SeededUniverse;
    let real: SeededUniverse;
    /** Rows a test added by hand, newest last, for cleanup. */
    let added: Array<{ model: string; id: string }> = [];
    /** Rows with no id column that a test added, each removed by its own statement. */
    let removals: Array<() => Promise<unknown>> = [];

    before(async () => {
      const url = process.env.DATABASE_URL ?? "";
      assert.ok(isLocalDatabase(url), "DATABASE_URL must point at a database on this machine. This test deletes demo accounts.");
      const { PrismaClient: Client } = await import("@prisma/client");
      connected = new Client({ datasources: { db: { url } } });
      const existing = await db().student.count({ where: { demoAccount: { not: null } } });
      assert.equal(existing, 0, "This database already holds demo accounts. Point DATABASE_URL at an empty test database.");
    });

    const write = async (model: string, data: Row) => void (await tableOf(db(), model).create({ data }));

    /** Moves the demo universe's creation and change times two hours back. See the header. */
    async function backdate(): Promise<void> {
      const old = new Date(Date.now() - 2 * 60 * 60_000);
      const ids = { in: [demo.studentId, demo.staffId] };
      await db().student.updateMany({ where: { id: ids }, data: { createdAt: old } });
      await db().message.updateMany({ where: { studentId: ids }, data: { createdAt: old } });
      await db().conversation.updateMany({ where: { studentId: ids }, data: { createdAt: old, updatedAt: old } });
      await db().auditLog.updateMany({ where: { actorId: ids }, data: { createdAt: old } });
    }

    /** Seeds a marked and an unmarked universe under prefixes no other run used. */
    async function seed(): Promise<void> {
      run += 1;
      const stamp = `cdb${Date.now().toString(36)}${run}`;
      demo = await seedUniverse(write, { prefix: `${stamp}dm-`, demo: true, tolerant: true });
      real = await seedUniverse(write, { prefix: `${stamp}rl-`, demo: false, tolerant: true });
      await backdate();
    }

    /** Removes whatever the test left, children before parents. Safe to run twice. */
    async function cleanup(): Promise<void> {
      if (!connected) return;
      for (const remove of removals) await remove();
      removals = [];
      const rows = [...(real?.created ?? []), ...(demo?.created ?? []), ...added].reverse();
      for (const row of rows) {
        if (row.id !== null) await tableOf(db(), row.model).deleteMany({ where: { id: { in: [row.id] } } });
      }
      await db().auditLog.deleteMany({ where: { action: "demo.closeout" } });
      added = [];
    }

    afterEach(cleanup);
    // Safe when `before` failed: nothing was connected, so there is nothing to clean or close.
    after(async () => {
      if (!connected) return;
      await cleanup();
      await connected.$disconnect();
    });

    /** Every table's row count and a checksum of every row, optionally leaving some rows out. */
    async function fingerprint(leaveOut: (row: Row) => boolean = () => false): Promise<Record<string, string>> {
      const result: Record<string, string> = {};
      for (const model of MODELS) {
        const rows = await tableOf(db(), model.name).findMany({ where: {}, select: scalarColumns(model.name) });
        const kept = rows.filter((row) => !leaveOut(row)).map((row) => JSON.stringify(row)).sort();
        result[model.name] = `${kept.length}:${createHash("sha256").update(kept.join("\n")).digest("hex")}`;
      }
      return result;
    }

    function scalarColumns(model: string): Record<string, true> {
      const fields = MODELS.find((entry) => entry.name === model)?.fields ?? [];
      return Object.fromEntries(fields.filter((field) => field.kind === "scalar" || field.kind === "enum").map((field) => [field.name, true]));
    }

    /** Rows anywhere that hold one of these ids in any single text column. */
    async function rowsNaming(ids: readonly string[]): Promise<string[]> {
      const found: string[] = [];
      for (const model of MODELS) {
        const columns = model.fields.filter((field) => field.kind === "scalar" && field.type === "String" && !field.isList);
        const count = await tableOf(db(), model.name).count({ where: { OR: columns.map((field) => ({ [field.name]: { in: ids } })) } });
        if (count > 0) found.push(`${model.name}:${count}`);
      }
      return found;
    }

    /** A row the demo universe wrote, by its own id, or the closeout's own audit row. A kept row that names a demo id still counts. */
    const isDemoRow = (row: Row) => (typeof row.id === "string" && row.id.startsWith(demo.prefix)) || row.action === "demo.closeout";
    const refusalCodes = (outcome: CloseoutOutcome): RefusalCode[] => outcome.refusals.map((refusal) => refusal.code);

    /** A copy of a seeded row with some columns changed, tracked for cleanup. */
    async function copyRow(model: string, sourceId: string, changes: Row): Promise<void> {
      const [source] = await tableOf(db(), model).findMany({ where: { id: sourceId }, select: scalarColumns(model) });
      assert.ok(source, `${model} was not seeded`);
      const id = typeof changes.id === "string" ? changes.id : `${sourceId}.copy`;
      await tableOf(db(), model).create({ data: { ...source, id, ...changes } });
      added.push({ model, id });
    }

    it("seeds a row in every model below Student and the class", async (t) => {
      await seed();

      t.diagnostic(`demo universe: ${demo.created.length} rows in ${new Set(demo.created.map((row) => row.model)).size} models`);
      t.diagnostic(`models Postgres refused a seeded row for: ${[...new Set([...demo.skipped, ...real.skipped])].join(", ") || "none"}`);
      const seeded = new Set(demo.created.map((row) => row.model));
      assert.deepEqual(MUST_SEED.filter((model) => !seeded.has(model)), []);
      assert.deepEqual(demo.skipped, []);
      assert.deepEqual(real.skipped, []);
    });

    it("previews without changing a row", async () => {
      await seed();
      const before = await fingerprint();

      const outcome = await closeout(db(), { apply: false });

      assert.deepEqual(outcome.refusals, []);
      assert.equal(outcome.kind, "preview");
      assert.deepEqual(outcome.kind === "preview" && outcome.preview.marked, { students: 1, instructors: 1, demoClasses: 1 });
      assert.deepEqual(await fingerprint(), before);
    });

    it("applies: no marked account, nothing naming a deleted account or class, every count as previewed", async () => {
      await seed();
      const preview = await closeout(db(), { apply: false });

      const outcome = await closeout(db(), { apply: true, expectAccounts: 2 });

      assert.equal(outcome.kind, "applied");
      assert.deepEqual(outcome.kind === "applied" && outcome.deleted, preview.kind === "preview" && preview.preview.rowsToDelete);
      assert.deepEqual(outcome.kind === "applied" && outcome.remaining, { markedAccounts: 0, rowsPointingAtDeleted: 0 });
      assert.deepEqual(outcome.kind === "applied" && outcome.afterCommit, { markedAccounts: 0 });
      assert.equal(await db().student.count({ where: { demoAccount: { not: null } } }), 0);
      assert.deepEqual(await rowsNaming([demo.studentId, demo.staffId, demo.classId]), []);
      assert.equal(await db().auditLog.count({ where: { action: "demo.closeout" } }), 1);
    });

    it("applies without touching a row that is not demo data, even a kept row that names a demo id", async () => {
      await seed();
      // Kept rows whose text names the demo universe: the fingerprint must compare them too.
      await db().systemConfig.create({ data: { id: `${real.prefix}setting`, key: `${real.prefix}pilot`, value: JSON.stringify([demo.classId]) } });
      await db().notification.create({ data: { id: `${real.prefix}notice`, studentId: real.staffId, type: "x", title: "x", body: `About ${demo.studentId}` } });
      added.push({ model: "SystemConfig", id: `${real.prefix}setting` }, { model: "Notification", id: `${real.prefix}notice` });
      const before = await fingerprint(isDemoRow);
      const realBefore = await rowsNaming([real.studentId, real.staffId, real.classId]);
      const previewBefore = await closeout(db(), { apply: false });

      await closeout(db(), { apply: true, expectAccounts: 2 });

      assert.deepEqual(await fingerprint(isDemoRow), before);
      assert.deepEqual(await rowsNaming([real.studentId, real.staffId, real.classId]), realBefore);
      assert.equal(await db().systemConfig.count({ where: { value: { contains: demo.classId } } }), 1);
      const previewAfter = await closeout(db(), { apply: false });
      assert.ok(previewBefore.kind === "preview" && previewAfter.kind === "preview");
      assert.deepEqual(previewAfter.preview.leftBehind.orphans, previewBefore.preview.leftBehind.orphans);
    });

    it("runs the owner's script: a preview, then an apply with the count the preview printed", async () => {
      const env = { NODE_ENV: "test" as const, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ADMIN_DATABASE_URL: process.env.DATABASE_URL ?? "" };
      const script = (args: readonly string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/demo-closeout.ts", ...args], { cwd: ROOT, env, encoding: "utf8" });
      await seed();

      const previewed = script([]);
      assert.equal(previewed.status, 0, previewed.stderr);
      assert.match(previewed.stdout, /^Target: database \S+ on host \S+/);
      const expected = /--expect-accounts=(\d+)/.exec(previewed.stdout)?.[1];
      assert.equal(expected, "2");
      const applied = script(["--apply", "--confirm-demo-disabled", `--expect-accounts=${expected}`]);

      assert.equal(applied.status, 0, applied.stderr);
      assert.match(applied.stdout, /Checked again after the closeout was saved: 0 accounts are marked as demo\./);
      assert.equal(`${applied.stdout}${previewed.stdout}`.includes(env.ADMIN_DATABASE_URL), false);
      assert.equal(await db().student.count({ where: { demoAccount: { not: null } } }), 0);
    });

    it("applies when a marked account's audit rows are about the demo student's own certification and appointment", async () => {
      await seed();
      for (const model of ["Certification", "Appointment"]) {
        await copyRow("AuditLog", `${demo.prefix}AuditLog`, { id: `${demo.prefix}AuditLog.${model}`, actorId: demo.staffId, targetType: model.toLowerCase(), targetId: `${demo.prefix}${model}`, createdAt: new Date(0) });
      }

      const outcome = await closeout(db(), { apply: true, expectAccounts: 2 });

      assert.deepEqual(outcome.refusals, []);
      assert.equal(outcome.kind, "applied");
      assert.equal(await db().auditLog.count({ where: { targetId: { in: [`${demo.prefix}Certification`, `${demo.prefix}Appointment`] } } }), 0);
    });

    it("does not count the actors production writes that are not accounts as orphans", async () => {
      await seed();
      const counted = async () => {
        const outcome = await closeout(db(), { apply: false });
        assert.ok(outcome.kind === "preview");
        return outcome.preview.leftBehind.orphans;
      };
      const before = await counted();
      for (const actorId of ["admin-key", "system", "system:sage-autopilot"]) {
        await insertRow("AuditLog", { id: `${real.prefix}sentinel-${actorId}`, action: "x", targetType: "x", actorId, createdAt: new Date(0) });
      }

      assert.deepEqual(await counted(), before);
    });

    it("keeps the shared rows a demo account merely referenced", async () => {
      await seed();

      await closeout(db(), { apply: true, expectAccounts: 2 });

      for (const model of ["Employer", "Opportunity", "CareerEvent", "FormTemplate", "OrientationItem"]) {
        assert.equal(await tableOf(db(), model).count({ where: { id: `${demo.prefix}${model}` } }), 1, model);
      }
    });

    interface DbRefusal {
      readonly name: string;
      readonly code: RefusalCode;
      readonly env?: Record<string, string>;
      /** The accounts the plan holds instead of every marked one. */
      readonly accounts?: () => string[];
      readonly expectAccounts?: number;
      readonly local?: CloseoutOptions["local"];
      /** Runs every transaction as this role, to stand in for a connection limited by row level security. */
      readonly asRole?: string;
      /** Changes the transaction the closeout is given, to stand in for a row written while it runs. */
      readonly wrap?: (tx: CloseoutTx) => CloseoutTx;
      readonly arrange?: () => Promise<void>;
    }
    const insertRow = async (model: string, data: Row & { id: string }) => {
      await tableOf(db(), model).create({ data });
      added.push({ model, id: data.id });
    };
    /** A teacher on a class. The table's key is the pair, so it has no id to clean up by. */
    const teaches = async (classId: string, instructorId: string) => {
      await db().spokesClassInstructor.create({ data: { classId, instructorId } });
      removals.push(() => db().spokesClassInstructor.deleteMany({ where: { classId, instructorId } }));
    };
    /** The transaction, with an audit row naming a missing account written right after the accounts are deleted. */
    const writeAfterAccountsGo = (tx: CloseoutTx): CloseoutTx => new Proxy(tx, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (property !== "student") return value;
        const table = tableOf(target, property);
        return {
          count: table.count.bind(table), findMany: table.findMany.bind(table), create: table.create.bind(table),
          deleteMany: async (args: Parameters<typeof table.deleteMany>[0]) => {
            const result = await table.deleteMany(args);
            await tableOf(target, "auditLog").create({ data: { id: `${demo.prefix}late-audit`, action: "x", targetType: "x", actorId: `${demo.prefix}missing-account` } });
            return result;
          },
        };
      },
    });
    const refusals: readonly DbRefusal[] = [
      { name: "demo mode is on", code: "demo_mode_on", env: { COHORT_DEMO_MODE: "true" } },
      { name: "the role cannot see every row", code: "cannot_see_every_row", asRole: "vq_app" },
      { name: "the checkout is at another migration", code: "schema_mismatch", local: { ...readLocalSchema(ROOT), migrations: [...readLocalSchema(ROOT).migrations, "29991231000000_not_applied"] } },
      // The newest name agrees: only the whole set shows the database never ran this one.
      { name: "the checkout has an older migration the database never applied", code: "schema_mismatch", local: { ...readLocalSchema(ROOT), migrations: ["00000000000001_never_applied", ...readLocalSchema(ROOT).migrations] } },
      { name: "the expected count is not the plan's", code: "expected_accounts_mismatch", expectAccounts: 3 },
      {
        name: "a marked account sent a message in the last 30 minutes", code: "demo_recently_active",
        arrange: () => copyRow("Message", `${demo.prefix}Message`, { createdAt: new Date() }),
      },
      {
        name: "a class holds the demo code but the demo instructor does not own it", code: "demo_class_not_owned",
        arrange: async () => void (await db().spokesClass.update({ where: { id: demo.classId }, data: { createdById: real.staffId } })),
      },
      { name: "the plan holds an account that is not marked", code: "plan_includes_unmarked", accounts: () => [real.studentId], expectAccounts: 1 },
      {
        name: "an unmarked student is enrolled in the demo class", code: "unmarked_student_in_demo_class",
        arrange: () => insertRow("StudentClassEnrollment", { id: `${real.prefix}enrolled`, classId: demo.classId, studentId: real.studentId }),
      },
      {
        name: "an unmarked teacher is on the demo class", code: "unmarked_rows_on_demo_class",
        arrange: () => teaches(demo.classId, real.staffId),
      },
      {
        name: "a marked account teaches a class that has unmarked students", code: "marked_staff_over_unmarked_students",
        arrange: () => teaches(real.classId, demo.staffId),
      },
      {
        name: "a marked account wrote a case note about an unmarked student", code: "marked_account_on_kept_rows",
        arrange: () => copyRow("CaseNote", `${real.prefix}CaseNote`, { authorId: demo.staffId }),
      },
      {
        name: "a marked account's audit row is about an unmarked student", code: "records_about_unmarked_people",
        arrange: () => copyRow("AuditLog", `${demo.prefix}AuditLog`, { actorId: demo.staffId, targetType: "student", targetId: real.studentId, createdAt: new Date(0) }),
      },
      {
        name: "a marked account's audit row is about an unmarked student's certification", code: "records_about_unmarked_people",
        arrange: () => copyRow("AuditLog", `${demo.prefix}AuditLog`, { actorId: demo.staffId, targetType: "certification", targetId: `${real.prefix}Certification`, createdAt: new Date(0) }),
      },
      {
        name: "a marked account's audit row is about an unmarked student's appointment", code: "records_about_unmarked_people",
        arrange: () => copyRow("AuditLog", `${demo.prefix}AuditLog`, { actorId: demo.staffId, targetType: "appointment", targetId: `${real.prefix}Appointment`, createdAt: new Date(0) }),
      },
      {
        name: "an unmarked student's task links to a demo appointment", code: "kept_rows_would_be_blanked",
        arrange: () => copyRow("StudentTask", `${real.prefix}StudentTask`, { appointmentId: `${demo.prefix}Appointment` }),
      },
      {
        name: "an unmarked student's portfolio item names a demo upload, with no foreign key", code: "kept_rows_name_deleted_rows",
        arrange: () => copyRow("PortfolioItem", `${real.prefix}PortfolioItem`, { fileId: `${demo.prefix}FileUpload` }),
      },
      {
        name: "an unmarked student's vision board item names a demo goal, with no foreign key", code: "kept_rows_name_deleted_rows",
        arrange: () => copyRow("VisionBoardItem", `${real.prefix}VisionBoardItem`, { goalId: `${demo.prefix}Goal` }),
      },
      {
        // Found only after deletes have run: Postgres cascades the unmarked link when the demo goal goes.
        name: "a cascade would remove an unmarked student's row", code: "unlisted_rows_removed",
        arrange: () => copyRow("GoalResourceLink", `${real.prefix}GoalResourceLink`, { goalId: `${demo.prefix}Goal` }),
      },
      {
        // Found only after every delete has run, the accounts included: no earlier check can see a row written then.
        name: "a row naming a missing account is written during the apply", code: "orphans_rose", wrap: writeAfterAccountsGo,
      },
      {
        // Found only after deletes have run: the marked teacher stays, and a column with no foreign key names the deleted student.
        name: "a row would be left naming a deleted account", code: "rows_left_pointing", accounts: () => [demo.studentId], expectAccounts: 1,
        arrange: () => copyRow("SageInsight", `${demo.prefix}SageInsight`, { studentId: demo.staffId, dismissedBy: demo.studentId }),
      },
    ];

    /** The test client, with every transaction run as `role` or changed by `wrap` when one is given. */
    function clientAs(role: string | undefined, wrap?: (tx: CloseoutTx) => CloseoutTx): CloseoutClient {
      if (wrap) return { $transaction: (work, options) => db().$transaction((tx) => work(wrap(tx)), options) };
      if (!role) return db();
      return {
        $transaction: (work, options) => db().$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('role', ${role}, true)`;
          return work(tx);
        }, options),
      };
    }

    it("has a Postgres case for every refusal", () => {
      assert.deepEqual(Object.keys(REFUSALS).filter((code) => !refusals.some((refusal) => refusal.code === code)), []);
    });

    for (const refusal of refusals) {
      it(`refuses and changes nothing when ${refusal.name}`, async (t) => {
        if (refusal.asRole) {
          const roles = await db().$queryRaw<Array<{ found: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${refusal.asRole}) AS found`;
          if (!roles[0]?.found) return t.skip(`this database has no ${refusal.asRole} role`);
        }
        await seed();
        await refusal.arrange?.();
        const before = await fingerprint();
        const accounts = refusal.accounts;
        const rule = accounts ? async () => ({ accountIds: accounts(), classIds: [] }) : undefined;

        const outcome = await closeout(clientAs(refusal.asRole, refusal.wrap), {
          apply: true, env: refusal.env, rule, expectAccounts: refusal.expectAccounts ?? 2, ...(refusal.local ? { local: refusal.local } : {}),
        });

        assert.ok(outcome.kind === "refused" || outcome.kind === "unreadable", outcome.kind);
        assert.ok(refusalCodes(outcome).includes(refusal.code), `refused for ${refusalCodes(outcome).join(", ")}`);
        assert.deepEqual(await fingerprint(), before);
      });
    }

    it("rolls everything back when a statement fails half way", async () => {
      await seed();
      const before = await fingerprint();
      let deletesBeforeFailure = 0;
      // The real transaction, with one table's delete replaced by a throw. The
      // Goal step runs after about fifteen others, so real rows are already gone.
      const failing = (tx: CloseoutTx): CloseoutTx => new Proxy(tx, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof property !== "string" || property.startsWith("$") || typeof value !== "object" || value === null) return value;
          const table = tableOf(target, property);
          return {
            count: table.count.bind(table), findMany: table.findMany.bind(table), create: table.create.bind(table),
            deleteMany: async (args: Parameters<typeof table.deleteMany>[0]) => {
              if (property === "goal") throw new Error("Injected failure while deleting Goal");
              const result = await table.deleteMany(args);
              deletesBeforeFailure += result.count;
              return result;
            },
          };
        },
      });
      const breaking: CloseoutClient = { $transaction: (work, options) => db().$transaction((tx) => work(failing(tx)), options) };

      await assert.rejects(closeout(breaking, { apply: true, expectAccounts: 2 }), /Injected failure/);

      assert.ok(deletesBeforeFailure > 0, "the failure must come after real deletes");
      assert.deepEqual(await fingerprint(), before);
    });
  });
}
