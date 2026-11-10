/**
 * What the demo closeout asks the database server before it trusts a count
 * (readiness H10): which database this is, whether the role can see every row,
 * whether the checkout matches the database, and whether the demo account
 * count is the one the owner previewed.
 *
 * The fake in closeout.fixtures.ts answers the tool's fixed statements from
 * its own state and refuses any statement it does not know. That the real
 * statements are valid SQL is something only closeout.db.test.ts can show.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readLocalSchema } from "./closeout.local";
import { REFUSALS, runDemoCloseout, type CloseoutOptions, type CloseoutOutcome, type CloseoutTarget } from "./closeout";
import { FAKE_MIGRATION, LOCAL, scene, type FakeDb, type Scene } from "./closeout.fixtures";

const preview = (db: FakeDb, extra: Partial<CloseoutOptions> = {}): Promise<CloseoutOutcome> =>
  runDemoCloseout(db.client(), { apply: false, env: {}, local: LOCAL, ...extra });
const apply = (db: FakeDb, extra: Partial<CloseoutOptions> = {}): Promise<CloseoutOutcome> =>
  runDemoCloseout(db.client(), { apply: true, env: {}, local: LOCAL, expectAccounts: 2, ...extra });

describe("demo closeout and the server", () => {
  it("turns row security filtering off before any other statement, in a preview and in an apply", async () => {
    const { db } = await scene();

    await preview(db);
    await apply(db);

    assert.equal(db.statementLog.length, 3);
    for (const statements of db.statementLog) assert.equal(statements[0], "SET LOCAL row_security = off");
  });

  it("takes the create lock as the first query of an apply, and takes no lock for a preview", async () => {
    const { db } = await scene();

    await preview(db);
    await apply(db);
    const [previewed, applied] = db.statementLog;

    assert.deepEqual(previewed.filter((sql) => /advisory/.test(sql)), []);
    assert.match(applied[1], /^SELECT pg_try_advisory_xact_lock/);
    assert.doesNotMatch(db.statementLog.flat().join("\n"), /pg_advisory_xact_lock\(/);
  });

  it("names the database and the address the server reports, in the outcome and to the caller", async () => {
    const { db } = await scene();
    const told: CloseoutTarget[] = [];

    const outcome = await preview(db, { onTarget: (target) => void told.push(target) });

    assert.deepEqual(outcome.target, { database: "closeout_fake", serverAddress: "10.0.0.7" });
    assert.deepEqual(told, [{ database: "closeout_fake", serverAddress: "10.0.0.7" }]);
  });

  it("tells the caller the target before a statement fails", async () => {
    const { db } = await scene();
    const told: CloseoutTarget[] = [];
    db.failOnDeleteOf = "Goal";

    await assert.rejects(apply(db, { onTarget: (target) => void told.push(target) }));

    assert.deepEqual(told, [{ database: "closeout_fake", serverAddress: "10.0.0.7" }]);
  });

  it("accepts a superuser that has no BYPASSRLS attribute", async () => {
    const { db } = await scene();
    db.bypassesRls = false;
    db.superuser = true;

    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
  });

  it("finds the migration ledger in the public schema too", async () => {
    const { db } = await scene();
    db.ledgerSchema = "public";

    const outcome = await preview(db);

    assert.deepEqual(outcome.refusals, []);
  });
});

interface Unreadable {
  name: string;
  code: "cannot_see_every_row" | "schema_mismatch";
  arrange?: (db: FakeDb) => void;
  local?: CloseoutOptions["local"];
}

const UNREADABLE: readonly Unreadable[] = [
  {
    name: "the role is limited by row level security", code: "cannot_see_every_row",
    arrange: (db) => { db.bypassesRls = false; },
  },
  {
    name: "the database has a newer migration than this checkout", code: "schema_mismatch",
    arrange: (db) => { db.appliedMigrations = [FAKE_MIGRATION, "20261201000000_added_after_the_checkout"]; },
  },
  {
    name: "this checkout has a newer migration than the database", code: "schema_mismatch",
    local: { ...LOCAL, newestMigration: "20261201000000_not_deployed_yet" },
  },
  {
    name: "the database has no migration ledger", code: "schema_mismatch",
    arrange: (db) => { db.ledgerSchema = null; },
  },
  {
    name: "the ledger lists no applied migration", code: "schema_mismatch",
    arrange: (db) => { db.appliedMigrations = []; },
  },
  { name: "this checkout has no migrations folder", code: "schema_mismatch", local: { ...LOCAL, newestMigration: null } },
  {
    name: "the schema file has a model the generated client does not know", code: "schema_mismatch",
    local: { ...LOCAL, schemaModels: [...LOCAL.schemaModels, "ModelAddedSinceGenerate"] },
  },
  {
    name: "the generated client has a model the schema file does not", code: "schema_mismatch",
    local: { ...LOCAL, schemaModels: LOCAL.schemaModels.slice(1) },
  },
];

describe("demo closeout refusals that come before any count", () => {
  for (const unreadable of UNREADABLE) {
    it(`refuses and changes nothing when ${unreadable.name}`, async () => {
      const { db } = await scene();
      unreadable.arrange?.(db);
      const before = db.snapshot();

      const outcome = await apply(db, { local: unreadable.local ?? LOCAL });

      assert.equal(outcome.kind, "unreadable");
      assert.deepEqual(outcome.refusals, [{ code: unreadable.code, sentence: REFUSALS[unreadable.code], count: 1 }]);
      assert.equal("preview" in outcome, false);
      assert.equal(db.snapshot(), before);
      assert.equal(db.writes, 0);
    });
  }

  it("gives a preview no counts either when the role cannot see every row", async () => {
    const { db } = await scene();
    db.bypassesRls = false;

    const outcome = await preview(db);

    assert.equal(outcome.kind, "unreadable");
    assert.deepEqual(outcome.refusals.map((entry) => entry.code), ["cannot_see_every_row"]);
  });

  it("reports both when the role is limited and the checkout does not match", async () => {
    const { db } = await scene();
    db.bypassesRls = false;
    db.appliedMigrations = ["20261201000000_added_after_the_checkout"];

    const outcome = await preview(db);

    assert.deepEqual(outcome.refusals.map((entry) => entry.code), ["cannot_see_every_row", "schema_mismatch"]);
  });
});

interface Counted {
  name: string;
  code: "expected_accounts_mismatch" | "demo_recently_active";
  expectAccounts?: number | null;
  arrange?: (staged: Scene) => void;
}

const COUNTED: readonly Counted[] = [
  { name: "the apply is given no expected account count", code: "expected_accounts_mismatch", expectAccounts: null },
  { name: "the expected count is lower than the marked accounts", code: "expected_accounts_mismatch", expectAccounts: 1 },
  { name: "the expected count is higher than the marked accounts", code: "expected_accounts_mismatch", expectAccounts: 3 },
  {
    name: "a demo account was created between the preview and the apply", code: "expected_accounts_mismatch",
    arrange: ({ db }) => void db.insert("Student", { id: "dm-late", studentId: "demo-late", displayName: "dm- Late", role: "student", demoAccount: "student" }),
  },
  {
    name: "another transaction holds the demo student create lock", code: "demo_recently_active",
    arrange: ({ db }) => { db.createLockHeld = true; },
  },
];

describe("demo closeout and the count the owner previewed", () => {
  for (const counted of COUNTED) {
    it(`refuses and changes nothing when ${counted.name}`, async () => {
      const staged = await scene();
      counted.arrange?.(staged);
      const before = staged.db.snapshot();
      const expectAccounts = counted.expectAccounts === null ? undefined : (counted.expectAccounts ?? 2);

      const outcome = await runDemoCloseout(staged.db.client(), { apply: true, env: {}, local: LOCAL, expectAccounts });

      assert.equal(outcome.kind, "refused");
      assert.deepEqual(outcome.refusals.filter((entry) => entry.code === counted.code),
        [{ code: counted.code, sentence: REFUSALS[counted.code], count: 1 }]);
      assert.equal(staged.db.snapshot(), before);
      assert.equal(staged.db.writes, 0);
    });
  }

  it("does not ask a preview for the expected count, and does not take it as a reason to refuse", async () => {
    const { db } = await scene();

    const outcome = await preview(db, { expectAccounts: 99 });

    assert.equal(outcome.kind, "preview");
    assert.deepEqual(outcome.refusals, []);
  });

  it("never says by how much the expected count was wrong", async () => {
    const { db } = await scene();

    const outcome = await apply(db, { expectAccounts: 40 });

    assert.deepEqual(outcome.refusals.map((entry) => entry.count), [1]);
  });
});

describe("demo closeout after the commit", () => {
  it("counts the marked accounts again in a new transaction and finds none", async () => {
    const { db } = await scene();

    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
    assert.deepEqual(outcome.kind === "applied" && outcome.afterCommit, { markedAccounts: 0 });
    assert.equal(db.transactions, 2);
    assert.deepEqual(db.statementLog[1], ["SET LOCAL row_security = off"]);
  });

  it("reports a demo account that was committed while the closeout ran", async () => {
    const { db } = await scene();
    db.afterNextCommit = () => void db.insert("Student", { id: "dm-raced", studentId: "demo-raced", displayName: "dm- Raced", role: "student", demoAccount: "student" });

    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
    assert.deepEqual(outcome.kind === "applied" && outcome.afterCommit, { markedAccounts: 1 });
  });

  it("says the count is unknown when the check after the commit cannot run", async () => {
    const { db } = await scene();
    db.afterNextCommit = () => { db.failOnCommit = new Error("connection closed"); };

    const outcome = await apply(db);

    assert.equal(outcome.kind, "applied");
    assert.deepEqual(outcome.kind === "applied" && outcome.afterCommit, { markedAccounts: null });
    assert.equal(db.rows("Student").filter((row) => row.demoAccount !== null).length, 0);
  });

  it("opens no second transaction after a preview or a refusal", async () => {
    const { db } = await scene();

    await preview(db);
    await apply(db, { expectAccounts: 7 });

    assert.equal(db.transactions, 2);
  });
});

describe("demo closeout reads this checkout", () => {
  const ROOT = path.resolve(__dirname, "../../..");

  it("finds the newest migration folder by name and every model in the schema file", () => {
    const local = readLocalSchema(ROOT);
    const folders = readdirSync(path.join(ROOT, "prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    assert.match(local.newestMigration ?? "", /^\d{14}_/);
    assert.deepEqual(folders.filter((name) => name > (local.newestMigration ?? "")), []);
    assert.deepEqual([...local.schemaModels].sort(), [...LOCAL.schemaModels].sort());
  });

  it("matches the generated client, so a run from an up to date checkout is not refused for it", async () => {
    const { db } = await scene();
    const local = readLocalSchema(ROOT);
    db.appliedMigrations = [local.newestMigration ?? ""];

    const outcome = await preview(db, { local });

    assert.deepEqual(outcome.refusals, []);
  });

  it("reports nothing, rather than throwing, for a folder that is not a checkout", () => {
    assert.deepEqual(readLocalSchema(path.join(ROOT, "no-such-folder")), { newestMigration: null, schemaModels: [] });
  });

  it("ignores files beside the migration folders", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "closeout-local-"));
    try {
      mkdirSync(path.join(folder, "prisma/migrations/20260101000000_first"), { recursive: true });
      mkdirSync(path.join(folder, "prisma/migrations/20260301000000_newest"));
      writeFileSync(path.join(folder, "prisma/migrations/migration_lock.toml"), "provider = \"postgresql\"\n");
      writeFileSync(path.join(folder, "prisma/schema.prisma"), "model One {\n  id String @id\n}\n\nenum Kind {\n  a\n}\n\nmodel Two {\n  id String @id\n}\n");

      assert.deepEqual(readLocalSchema(folder), { newestMigration: "20260301000000_newest", schemaModels: ["One", "Two"] });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
