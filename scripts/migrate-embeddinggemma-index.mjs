#!/usr/bin/env node
/** Stage locally; atomically switch vectors+settings only after explicit apply.
 * Never prints source text, IDs, vectors, connection strings, or credentials.
 * Run with node --env-file=<private env> scripts/migrate-embeddinggemma-index.mjs.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const MODEL = "google/embeddinggemma-2";
const ROOT = path.join(os.homedir(), ".local/share/visionquest/embeddinggemma-2/migrations");
const args = process.argv.slice(2);
const mode = args[0] ?? "help";
const file = args[1];
const db = new PrismaClient();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const specs = {
  ProgramDocument: { text: `title || CASE WHEN COALESCE("sageContextNote", '') <> '' THEN E'\\n' || "sageContextNote" ELSE '' END`, where: `embedding IS NOT NULL OR ("isActive" AND "usedBySage")` },
  DocumentChunk: { text: `content`, where: `true` },
  SageMemory: { text: `content`, where: `embedding IS NOT NULL OR "validTo" IS NULL` },
};
const switchKeys = ["ai_provider", "ai_provider_url", "ai_provider_model", "ai_provider_embedding_model", "ai_provider_auth_mode", "ai_provider_api_style", "ai_cloud_policy"];

async function readRows(client, table) {
  const spec = specs[table];
  return client.$queryRawUnsafe(`SELECT id, ${spec.text} AS text, embedding::text AS vector, "embeddingModel" AS model FROM visionquest."${table}" WHERE ${spec.where} ORDER BY id`);
}
function save(target, data) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, JSON.stringify(data), { mode: 0o600, flag: "wx" });
}
function validateVector(vector) {
  if (!Array.isArray(vector) || vector.length !== 768 || !vector.every(Number.isFinite) || Math.abs(Math.hypot(...vector) - 1) > 1e-4) throw new Error("Invalid staged vector");
}

async function stage() {
  const target = file ?? path.join(ROOT, new Date().toISOString().replaceAll(":", "-"), "staged.json");
  const data = { model: MODEL, createdAt: new Date().toISOString(), tables: {}, settings: await db.systemConfig.findMany({ where: { key: { in: switchKeys } } }) };
  for (const table of Object.keys(specs)) {
    const rows = await readRows(db, table);
    const staged = [];
    for (let i = 0; i < rows.length; i += 4) {
      const batch = rows.slice(i, i + 4);
      const response = await fetch("http://127.0.0.1:11436/api/embed", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ model: MODEL, input: batch.map((row) => `title: none | text: ${row.text}`) }),
      });
      if (!response.ok) throw new Error(`Local embedding failed with HTTP ${response.status}`);
      const { embeddings } = await response.json();
      if (embeddings.length !== batch.length) throw new Error("Embedding count mismatch");
      batch.forEach((row, j) => {
        validateVector(embeddings[j]);
        staged.push({ id: row.id, sourceHash: hash(row.text), before: { vector: row.vector, model: row.model }, after: { vector: JSON.stringify(embeddings[j]), model: MODEL } });
      });
      if ((i + 4) % 40 === 0 || i + 4 >= rows.length) console.log(`${table}: ${Math.min(i + 4, rows.length)}/${rows.length} staged`);
      // Yield between batches; interactive chat shares the same Apple GPU.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    data.tables[table] = staged;
  }
  save(target, data);
  console.log(JSON.stringify({ stagedFile: target, counts: Object.fromEntries(Object.entries(data.tables).map(([t, rows]) => [t, rows.length])), databaseWrites: 0 }));
}

async function mutate(rollback) {
  if (!file || !args.includes("--apply")) throw new Error("Mutation requires a staged file and --apply");
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.model !== MODEL) throw new Error("Wrong staged model");
  const endpoint = args.find((v) => v.startsWith("--endpoint="))?.slice(11);
  const authMode = args.find((v) => v.startsWith("--auth-mode="))?.slice(12);
  if (!rollback && (!endpoint || !["cloudflare_service_token", "bearer"].includes(authMode) || !endpoint.startsWith("https://"))) throw new Error("Activation requires the verified secured HTTPS endpoint and auth mode");
  const receiptFile = path.join(path.dirname(file), rollback ? "rollback-receipt.json" : "activation-receipt.json");
  // Existing receipt means the outcome needs inspection, not blind replay.
  try { readFileSync(receiptFile); throw new Error("Receipt already exists; inspect the previous outcome"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const newSettings = { ai_provider: "local", ai_provider_url: endpoint, ai_provider_model: "gemma4:12b", ai_provider_embedding_model: MODEL, ai_provider_auth_mode: authMode, ai_provider_api_style: "ollama", ai_cloud_policy: "local_only" };
  const counts = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE visionquest."ProgramDocument", visionquest."DocumentChunk", visionquest."SageMemory", visionquest."SystemConfig" IN SHARE ROW EXCLUSIVE MODE`);
    const currentSettings = await tx.systemConfig.findMany({ where: { key: { in: switchKeys } } });
    if (!rollback) {
      for (const key of switchKeys) {
        if (currentSettings.find((r) => r.key === key)?.value !== data.settings.find((r) => r.key === key)?.value) throw new Error("Settings changed after staging; refresh before activation");
      }
    } else if (currentSettings.find((r) => r.key === "ai_provider_embedding_model")?.value !== MODEL) throw new Error("Active model changed after migration; refusing rollback");
    const result = {};
    for (const table of Object.keys(specs)) {
      const rows = await readRows(tx, table);
      const staged = data.tables[table];
      if (rows.length !== staged.length) throw new Error(`${table} membership changed; restage or reconcile rollback`);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], entry = staged[i];
        if (row.id !== entry.id || hash(row.text) !== entry.sourceHash) throw new Error(`${table} source changed; refusing to overwrite`);
        if (rollback ? row.model !== MODEL : row.model !== entry.before.model || row.vector !== entry.before.vector) throw new Error(`${table} vector changed; refusing to overwrite`);
        const next = rollback ? entry.before : entry.after;
        if (!rollback) validateVector(JSON.parse(next.vector));
        await tx.$executeRawUnsafe(`UPDATE visionquest."${table}" SET embedding = $1::vector(768), "embeddingModel" = $2 WHERE id = $3`, next.vector, next.model, entry.id);
      }
      result[table] = rows.length;
    }
    if (rollback) {
      for (const key of switchKeys) {
        const previous = data.settings.find((r) => r.key === key);
        if (previous) await tx.systemConfig.upsert({ where: { key }, create: { key, value: previous.value }, update: { value: previous.value } });
        else await tx.systemConfig.deleteMany({ where: { key } });
      }
    } else {
      for (const [key, value] of Object.entries(newSettings)) await tx.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    return result;
  }, { timeout: 120_000, maxWait: 10_000, isolationLevel: "Serializable" });
  save(receiptFile, { at: new Date().toISOString(), rollback, counts, model: rollback ? "restored previous values" : MODEL, stageSha256: hash(readFileSync(file)) });
  console.log(JSON.stringify({ receiptFile, counts, rollback }));
}

try {
  if (mode === "stage") await stage();
  else if (mode === "activate") await mutate(false);
  else if (mode === "rollback") await mutate(true);
  else console.log("Usage: stage [file] | activate file --apply --endpoint=https://... --auth-mode=cloudflare_service_token | rollback file --apply");
} catch (error) {
  // Prisma errors can include query parameters; do not log them or input text.
  console.error(error?.name?.includes("Prisma") ? "Database operation failed; transaction rolled back. Inspect connection/configuration privately." : error.message);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
