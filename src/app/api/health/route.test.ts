import assert from "node:assert/strict";
import { before, beforeEach, it, mock } from "node:test";

let connected = true;
let databaseWorks = true;
let GET: typeof import("./route").GET;
before(async () => {
  mock.module("@/lib/db", { namedExports: { prismaAdmin: {
    $queryRaw: async () => { if (!databaseWorks) throw new Error("private database detail"); return [{ exists: true }]; },
  } } });
  mock.module("@/lib/health", { namedExports: { getMissingRequiredTables: async () => [] } });
  mock.module("@/lib/sage-availability", { namedExports: {
    getSageAvailability: async () => ({ connected, checkedAt: "2026-11-12T00:00:00.000Z" }),
  } });
  mock.module("@/lib/logger", { namedExports: { logger: { error() {} } } });
  ({ GET } = await import("./route"));
});
beforeEach(() => { connected = true; databaseWorks = true; });

it("reports Sage connection in healthy app responses", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).sage, { connected: true, checkedAt: "2026-11-12T00:00:00.000Z" });
});
it("keeps the app healthy when only Sage is unavailable", async () => {
  connected = false;
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "healthy");
  assert.equal(body.sage.connected, false);
});
it("still returns 503 on database failure without leaking the error", async () => {
  databaseWorks = false;
  const res = await GET();
  assert.equal(res.status, 503);
  assert.doesNotMatch(JSON.stringify(await res.json()), /private|detail/);
});
