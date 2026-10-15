/** Real pgvector transaction checks in a disposable, loopback-only database.
 * VQ_TEST_MIGRATION_DB=1 PG_BIN=/path/to/postgres/bin node --test scripts/migrate-embeddinggemma-index.test.mjs
 * Never reads DATABASE_URL or any existing database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";

test("activation and rollback are atomic and reject stale sources/settings", { skip: process.env.VQ_TEST_MIGRATION_DB !== "1" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vq-index-test-"));
  const pg = (name, args) => {
    const r = spawnSync(path.join(process.env.PG_BIN || "", name), args, { encoding: "utf8" });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  };
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const url = `postgresql://${process.env.USER}@127.0.0.1:${port}/postgres?schema=visionquest`;
  const db = new PrismaClient({ datasourceUrl: url });
  let started = false;
  try {
    pg("initdb", ["-D", path.join(root, "db"), "-A", "trust", "--no-locale"]);
    pg("pg_ctl", ["-D", path.join(root, "db"), "-l", path.join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -k ${root}`, "-w", "start"]);
    started = true;
    await db.$executeRawUnsafe('CREATE SCHEMA visionquest');
    await db.$executeRawUnsafe('CREATE EXTENSION vector WITH SCHEMA visionquest');
    for (const table of ["ProgramDocument", "DocumentChunk", "SageMemory"]) {
      await db.$executeRawUnsafe(`CREATE TABLE visionquest."${table}" (id text PRIMARY KEY, title text, content text, "sageContextNote" text, "isActive" boolean, "usedBySage" boolean, "validTo" timestamp, embedding vector(768), "embeddingModel" text)`);
    }
    await db.$executeRawUnsafe('CREATE TABLE visionquest."SystemConfig" (id text PRIMARY KEY, key text UNIQUE NOT NULL, value text NOT NULL, "updatedAt" timestamp NOT NULL, "updatedBy" text)');
    await db.systemConfig.create({ data: { key: "ai_provider", value: "cloud" } });
    const oldVector = JSON.stringify([1, ...Array(767).fill(0)]);
    const newVector = JSON.stringify([0, 1, ...Array(766).fill(0)]);
    const data = { model: "google/embeddinggemma-2", settings: await db.systemConfig.findMany(), tables: {} };
    for (const table of ["ProgramDocument", "DocumentChunk", "SageMemory"]) {
      await db.$executeRawUnsafe(`INSERT INTO visionquest."${table}" (id, title, content, "isActive", "usedBySage", embedding, "embeddingModel") VALUES ('synthetic', 'Synthetic', 'Synthetic', true, true, $1::vector, 'old-model')`, oldVector);
      data.tables[table] = [{ id: "synthetic", sourceHash: createHash("sha256").update("Synthetic").digest("hex"), before: { vector: oldVector, model: "old-model" }, after: { vector: newVector, model: data.model } }];
    }
    const file = path.join(root, "staged.json");
    writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
    const run = (mode) => spawnSync(process.execPath, ["scripts/migrate-embeddinggemma-index.mjs", mode, file, "--apply", "--endpoint=https://synthetic.invalid", "--auth-mode=bearer"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
    const snapshot = async () => ({
      tables: await Promise.all(Object.keys(data.tables).map((t) => db.$queryRawUnsafe(`SELECT embedding::text AS vector, "embeddingModel" AS model FROM visionquest."${t}"`))),
      settings: (await db.systemConfig.findMany({ orderBy: { key: "asc" } })).map(({ key, value }) => ({ key, value })),
    });
    const before = await snapshot();
    const activation = run("activate");
    assert.equal(activation.status, 0, activation.stderr);
    const activated = await snapshot();
    assert.ok(activated.tables.every(([r]) => r.model === data.model && r.vector === newVector));
    assert.ok(activated.settings.some((r) => r.key === "ai_cloud_policy" && r.value === "local_only"));
    const rollback = run("rollback");
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.deepEqual(await snapshot(), before);
    rmSync(path.join(root, "activation-receipt.json"));
    // ProgramDocument updates first, then the changed chunk aborts the transaction.
    await db.$executeRawUnsafe('UPDATE visionquest."DocumentChunk" SET content = \'Changed\'');
    const staleSource = run("activate");
    assert.notEqual(staleSource.status, 0);
    assert.match(staleSource.stderr, /source changed/);
    assert.deepEqual(await snapshot(), before);
    await db.$executeRawUnsafe('UPDATE visionquest."DocumentChunk" SET content = \'Synthetic\'');
    await db.systemConfig.update({ where: { key: "ai_provider" }, data: { value: "local" } });
    const changedSettings = await snapshot();
    const staleConfig = run("activate");
    assert.notEqual(staleConfig.status, 0);
    assert.match(staleConfig.stderr, /Settings changed/);
    assert.deepEqual(await snapshot(), changedSettings);
  } finally {
    await db.$disconnect();
    if (started) pg("pg_ctl", ["-D", path.join(root, "db"), "-m", "fast", "-w", "stop"]);
    rmSync(root, { recursive: true, force: true });
  }
});
