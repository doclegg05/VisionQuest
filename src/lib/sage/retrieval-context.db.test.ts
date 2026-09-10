/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma proxy preserves real tagged SQL in the integration harness. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it, mock } from "node:test";
import { PrismaClient } from "@prisma/client";

const enabled = process.env.AI_CONTEXT_DB_TEST_ENABLED === "true";
const url = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("AI context fixtures require a disposable localhost database.");
}
const db = new PrismaClient({ datasourceUrl: url || "postgresql://localhost/unused" });
const prefix = `context-fixture-${randomUUID()}`;
const model = prefix;
const vector = [1, ...new Array(767).fill(0)];
let role = "student";
let getDocumentContext: typeof import("./knowledge-base-server").getDocumentContext;
async function asRole(fn: (tx: any) => Promise<any>) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE vq_app");
    await tx.$executeRaw`SELECT set_config('app.current_role', ${role}, true)`;
    return fn(tx);
  });
}
if (enabled) {
  mock.module("@/lib/db", { namedExports: { prisma: {
    $queryRaw: (...args: any[]) => asRole(tx => tx.$queryRaw(...args)),
    programDocument: { findMany: (args: any) => asRole(tx => tx.programDocument.findMany(args)) },
    sageSnippet: { findMany: (args: any) => asRole(tx => tx.sageSnippet.findMany(args)) },
  } } });
  mock.module("@/lib/ai/embeddings", { namedExports: {
    embedTextsWithModel: async () => ({ vectors: [vector], model }),
    toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
    EMBEDDING_DIMENSIONS: 768,
  } });
  mock.module("@/lib/ai/embedding-provider", { namedExports: { getActiveEmbeddingModel: async () => model } });
}

describe("real SQL to emitted AI context", { skip: !enabled }, () => {
  before(async () => {
    process.env.SAGE_RAG_MODE = "hybrid";
    process.env.SAGE_RAG_ENABLED = "true";
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "0.40";
    ({ getDocumentContext } = await import("./knowledge-base-server"));
    for (const [suffix, audience, active, used] of [
      ["student", "STUDENT", true, true], ["teacher", "TEACHER", true, true],
      ["disabled", "BOTH", false, true], ["unused", "BOTH", true, false],
    ] as const) {
      const id = `${prefix}-${suffix}`;
      await db.programDocument.create({ data: {
        id, title: `${suffix} quasarzebra reference`, storageKey: `synthetic/${id}.pdf`,
        category: "STUDENT_RESOURCE", audience, isActive: active, usedBySage: used,
        sageContextNote: `quasarzebra summary ${suffix}`, embeddingModel: model,
        chunks: { create: { chunkIndex: 0, content: `quasarzebra body evidence ${suffix}`,
          pageNumber: 7, sectionTitle: "Verified section", extractionMethod: "ocr", embeddingModel: model } },
      } });
      await db.$executeRaw`UPDATE visionquest."ProgramDocument" SET embedding=${JSON.stringify(vector)}::vector WHERE id=${id}`;
      await db.$executeRaw`UPDATE visionquest."DocumentChunk" SET embedding=${JSON.stringify(vector)}::vector WHERE "documentId"=${id}`;
    }
  });
  after(async () => {
    await db.programDocument.deleteMany({ where: { id: { startsWith: prefix } } });
    await db.$disconnect();
  });
  it("emits source, actual passage, page and OCR provenance while excluding restricted rows", async () => {
    role = "student";
    const context = await getDocumentContext("quasarzebra", "student", 3, 6000);
    assert.match(context, /quasarzebra body evidence student/);
    assert.match(context, /p\.7/);
    assert.match(context, /OCR transcription/);
    assert.ok(context.includes(`id=${prefix}-student&mode=view`));
    for (const suffix of ["teacher", "disabled", "unused"]) assert.ok(!context.includes(`${prefix}-${suffix}`));
  });
  it("staff can retrieve teacher evidence without activating disabled sources", async () => {
    role = "teacher";
    const context = await getDocumentContext("quasarzebra", "staff", 3, 6000);
    assert.match(context, /quasarzebra body evidence teacher/);
    assert.ok(!context.includes(`${prefix}-disabled`));
    assert.ok(!context.includes(`${prefix}-unused`));
  });
  it("a tight budget preserves a complete source identity and excludes partial entries", async () => {
    role = "student";
    const context = await getDocumentContext("quasarzebra", "student", 3, 600);
    assert.ok(context.length <= 600);
    assert.ok(context.includes(`id=${prefix}-student&mode=view`));
    assert.ok(!context.includes(`${prefix}-teacher`));
  });
});
