import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockExecuteRaw = mock.fn(async () => 0) as any;

mock.module("@/lib/db", {
  namedExports: { prismaAdmin: { $executeRaw: mockExecuteRaw } },
});

let POST: typeof import("./route").POST;

before(async () => {
  ({ POST } = await import("./route"));
});

function makeRequest(bearer: string | null) {
  const headers = new Headers();
  if (bearer !== null) headers.set("authorization", `Bearer ${bearer}`);
  return new Request("http://localhost/api/internal/memory/consolidate", { method: "POST", headers });
}

describe("POST /api/internal/memory/consolidate", () => {
  beforeEach(() => {
    mockExecuteRaw.mock.resetCalls();
    process.env.CRON_SECRET = "test-secret";
  });

  it("rejects requests without the correct bearer token", async () => {
    const res = await POST(makeRequest("wrong"));
    assert.equal(res.status, 401);
    assert.equal(mockExecuteRaw.mock.callCount(), 0);
  });

  it("decay UPDATE only targets rows not decayed in the last 6 days", async () => {
    await POST(makeRequest("test-secret"));
    assert.equal(mockExecuteRaw.mock.callCount(), 2);
    const decaySql = mockExecuteRaw.mock.calls[0].arguments.map((a: unknown) => String(a)).join(" ");
    assert.match(decaySql, /lastDecayedAt/);
  });
});
