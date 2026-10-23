import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
const url = process.env.MEMORY_TEST_DATABASE_URL;
// Explicit opt-in, dedicated local database only. Never load .env.local.
if (url && (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/postgres\?/.test(url))) throw new Error("Use the isolated memory-test database on port 55439");
mock.module("@/lib/ai/identity", { namedExports: { loadIdentityInput: async () => ({}) } });
mock.module("@/lib/db", { namedExports: { prisma: new Proxy({}, { get: () => { throw new Error("Write escaped the job transaction"); } }) } });
it("memory writes roll back when their owning job transaction expires", { skip: !url }, async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  process.env.COHORT_DEMO_LOCAL_ONLY = "true";
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS visionquest`);
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS visionquest."SageMemory" (
      id text PRIMARY KEY, "subjectType" text, "subjectId" text, kind text, content text, category text,
      confidence float, "sourceType" text, "sourceId" text, "sourceHash" text,
      "validFrom" timestamp DEFAULT NOW(), "validTo" timestamp, "suppressedByStaff" boolean DEFAULT false,
      "createdAt" timestamp DEFAULT NOW(), "updatedAt" timestamp)`);
    const { storeMemoryCandidates } = await import("./store");
    const candidates = ["Prefers morning classes.", "Uses the bus."].map(content => ({
      subjectType: "student" as const, subjectId: "transaction-fixture", kind: "semantic" as const,
      content, category: "preference" as const, confidence: 0.9, sourceType: "conversation" as const, sourceId: "fixture",
    }));
    await assert.rejects(db.$transaction(async tx => {
      let inserted = false;
      const delayed = new Proxy(tx, { get(target, key) {
        if (key !== "sageMemory") return Reflect.get(target, key);
        return new Proxy(target.sageMemory, { get(model, operation) {
          if (operation !== "create") return Reflect.get(model, operation);
          return async (args: Parameters<typeof model.create>[0]) => {
            const row = await model.create(args);
            if (!inserted) { inserted = true; await new Promise(resolve => setTimeout(resolve, 350)); }
            return row;
          };
        } });
      } }) as Prisma.TransactionClient;
      await storeMemoryCandidates(candidates, { transaction: delayed, usage: { studentId: "transaction-fixture", callSite: "test" }, semanticDedupe: true });
    }, { timeout: 150 }));
    assert.equal(await db.sageMemory.count({ where: { subjectId: "transaction-fixture" } }), 0);
  } finally { delete process.env.COHORT_DEMO_LOCAL_ONLY; await db.$disconnect(); }
});
