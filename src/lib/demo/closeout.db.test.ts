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
 * Typical usage:
 *   DEMO_CLOSEOUT_DB_TEST_ENABLED=true DATABASE_URL=postgres://...test... \
 *     node --import tsx --test src/lib/demo/closeout.db.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { runDemoCloseout, tableOf, type CloseoutClient, type CloseoutOutcome, type CloseoutTx, type RefusalCode } from "./closeout";
import { MODELS, seedUniverse, type Row, type SeededUniverse } from "./closeout.fixtures";

const SHOULD_RUN = process.env.DEMO_CLOSEOUT_DB_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;
const DEMO_OFF = {};
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
    let client: PrismaClient;
    let run = 0;
    let demo: SeededUniverse;
    let real: SeededUniverse;
    /** Rows a test added by hand, newest last, for cleanup. */
    let added: Array<{ model: string; id: string }> = [];

    before(async () => {
      const url = process.env.DATABASE_URL ?? "";
      assert.ok(isLocalDatabase(url), "DATABASE_URL must point at a database on this machine. This test deletes demo accounts.");
      const { PrismaClient: Client } = await import("@prisma/client");
      client = new Client({ datasources: { db: { url } } });
      const existing = await client.student.count({ where: { demoAccount: { not: null } } });
      assert.equal(existing, 0, "This database already holds demo accounts. Point DATABASE_URL at an empty test database.");
    });

    const write = async (model: string, data: Row) => void (await tableOf(client, model).create({ data }));

    /** Seeds a marked and an unmarked universe under prefixes no other run used. */
    async function seed(): Promise<void> {
      run += 1;
      const stamp = `cdb${Date.now().toString(36)}${run}`;
      demo = await seedUniverse(write, { prefix: `${stamp}dm-`, demo: true, tolerant: true });
      real = await seedUniverse(write, { prefix: `${stamp}rl-`, demo: false, tolerant: true });
    }

    /** Removes whatever the test left, children before parents. Safe to run twice. */
    async function cleanup(): Promise<void> {
      const rows = [...(real?.created ?? []), ...(demo?.created ?? []), ...added].reverse();
      for (const row of rows) {
        if (row.id !== null) await tableOf(client, row.model).deleteMany({ where: { id: { in: [row.id] } } });
      }
      await client.auditLog.deleteMany({ where: { action: "demo.closeout" } });
      added = [];
    }

    afterEach(cleanup);
    after(async () => {
      await cleanup();
      await client.$disconnect();
    });

    /** Every table's row count and a checksum of every row, optionally leaving some rows out. */
    async function fingerprint(leaveOut: (row: string) => boolean = () => false): Promise<Record<string, string>> {
      const result: Record<string, string> = {};
      for (const model of MODELS) {
        const rows = await tableOf(client, model.name).findMany({ where: {}, select: scalarColumns(model.name) });
        const kept = rows.map((row) => JSON.stringify(row)).filter((row) => !leaveOut(row)).sort();
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
        const count = await tableOf(client, model.name).count({ where: { OR: columns.map((field) => ({ [field.name]: { in: ids } })) } });
        if (count > 0) found.push(`${model.name}:${count}`);
      }
      return found;
    }

    const isDemoRow = (row: string) => row.includes(demo.prefix) || row.includes('"action":"demo.closeout"');
    const refusalCodes = (outcome: CloseoutOutcome): RefusalCode[] => outcome.refusals.map((refusal) => refusal.code);

    /** A copy of a seeded row with some columns changed, tracked for cleanup. */
    async function copyRow(model: string, sourceId: string, changes: Row): Promise<void> {
      const [source] = await tableOf(client, model).findMany({ where: { id: sourceId }, select: scalarColumns(model) });
      assert.ok(source, `${model} was not seeded`);
      const id = `${sourceId}.copy`;
      await tableOf(client, model).create({ data: { ...source, id, ...changes } });
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

      const outcome = await runDemoCloseout(client, { apply: false, env: DEMO_OFF });

      assert.equal(outcome.kind, "preview");
      assert.deepEqual(outcome.refusals, []);
      assert.deepEqual(outcome.preview.marked, { students: 1, instructors: 1, demoClasses: 1 });
      assert.deepEqual(await fingerprint(), before);
    });

    it("applies: no marked account, nothing naming a deleted account or class, every count as previewed", async () => {
      await seed();
      const preview = await runDemoCloseout(client, { apply: false, env: DEMO_OFF });

      const outcome = await runDemoCloseout(client, { apply: true, env: DEMO_OFF });

      assert.equal(outcome.kind, "applied");
      assert.deepEqual(outcome.deleted, preview.preview.rowsToDelete);
      assert.deepEqual(outcome.remaining, { markedAccounts: 0, rowsPointingAtDeleted: 0 });
      assert.equal(await client.student.count({ where: { demoAccount: { not: null } } }), 0);
      assert.deepEqual(await rowsNaming([demo.studentId, demo.staffId, demo.classId]), []);
      assert.equal(await client.auditLog.count({ where: { action: "demo.closeout" } }), 1);
    });

    it("applies without touching a row that is not demo data", async () => {
      await seed();
      const before = await fingerprint(isDemoRow);
      const realBefore = await rowsNaming([real.studentId, real.staffId, real.classId]);

      await runDemoCloseout(client, { apply: true, env: DEMO_OFF });

      assert.deepEqual(await fingerprint(isDemoRow), before);
      assert.deepEqual(await rowsNaming([real.studentId, real.staffId, real.classId]), realBefore);
    });

    it("keeps the shared rows a demo account merely referenced", async () => {
      await seed();

      await runDemoCloseout(client, { apply: true, env: DEMO_OFF });

      for (const model of ["Employer", "Opportunity", "CareerEvent", "FormTemplate", "OrientationItem"]) {
        assert.equal(await tableOf(client, model).count({ where: { id: `${demo.prefix}${model}` } }), 1, model);
      }
    });

    const refusals: ReadonlyArray<{ name: string; code: RefusalCode; env?: Record<string, string>; subset?: boolean; arrange?: () => Promise<void> }> = [
      { name: "demo mode is on", code: "demo_mode_on", env: { COHORT_DEMO_MODE: "true" } },
      {
        name: "an unmarked student is enrolled in the demo class", code: "unmarked_student_in_demo_class",
        arrange: async () => {
          const row = await client.studentClassEnrollment.create({ data: { classId: demo.classId, studentId: real.studentId }, select: { id: true } });
          added.push({ model: "StudentClassEnrollment", id: row.id });
        },
      },
      {
        name: "a marked account wrote a case note about an unmarked student", code: "marked_account_on_kept_rows",
        arrange: () => copyRow("CaseNote", `${real.prefix}CaseNote`, { authorId: demo.staffId }),
      },
      {
        // Found only after deletes have run: Postgres cascades the unmarked link when the demo goal goes.
        name: "a cascade would remove an unmarked student's row", code: "unlisted_rows_removed",
        arrange: () => copyRow("GoalResourceLink", `${real.prefix}GoalResourceLink`, { goalId: `${demo.prefix}Goal` }),
      },
      {
        // Found only after deletes have run: the marked teacher stays and its goal names the deleted student.
        name: "a row would be left naming a deleted account", code: "rows_left_pointing", subset: true,
        arrange: () => copyRow("Goal", `${demo.prefix}Goal`, { studentId: demo.staffId, confirmedBy: demo.studentId, parentId: null }),
      },
    ];

    for (const refusal of refusals) {
      it(`refuses and changes nothing when ${refusal.name}`, async () => {
        await seed();
        await refusal.arrange?.();
        const before = await fingerprint();
        const rule = refusal.subset ? async () => ({ accountIds: [demo.studentId], classIds: [] }) : undefined;

        const outcome = await runDemoCloseout(client, { apply: true, env: refusal.env ?? DEMO_OFF, rule });

        assert.equal(outcome.kind, "refused");
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
      const breaking: CloseoutClient = { $transaction: (work, options) => client.$transaction((tx) => work(failing(tx)), options) };

      await assert.rejects(runDemoCloseout(breaking, { apply: true, env: DEMO_OFF }), /Injected failure/);

      assert.ok(deletesBeforeFailure > 0, "the failure must come after real deletes");
      assert.deepEqual(await fingerprint(), before);
    });
  });
}
