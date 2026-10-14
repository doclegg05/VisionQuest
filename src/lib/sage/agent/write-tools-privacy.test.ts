import assert from "node:assert/strict";
import { it, mock } from "node:test";

const logs: unknown[] = [];
const operations: Record<string, unknown>[] = [];
mock.module("@/lib/db", { namedExports: { prisma: {}, prismaAdmin: {} } });
mock.module("@/lib/logger", { namedExports: { logger: {
  error: (...args: unknown[]) => logs.push(args),
  warn: (...args: unknown[]) => logs.push(args),
  info: (...args: unknown[]) => logs.push(args),
} } });
mock.module("../operations", { namedExports: {
  operationIdFor: () => "operation",
  recordOperation: async (record: Record<string, unknown>) => { operations.push(record); },
} });

it("write-tool failures do not copy thrown private details into logs or the operation summary", async () => {
  const { executeAndLedger } = await import("./write-tools");
  const secret = "private database value from failing query";
  const result = await executeAndLedger("file_document", {}, {
    session: { id: "student", studentId: "student", displayName: "Test", role: "student" },
    conversationId: "conversation",
  }, async () => { throw new Error(secret); });
  assert.equal(result.status, "error");
  assert.equal(operations.length, 1);
  assert.equal(operations[0].status, "failed");
  assert.equal(operations[0].resultSummary, result.summary);
  assert.equal(logs.length, 1);
  assert.ok(!JSON.stringify({ result, operations, logs }).includes(secret));
});
