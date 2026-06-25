import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

let POST: (req: Request) => Promise<Response>;

mock.module("@/lib/sage/wagers", {
  namedExports: {
    resolveDueWagers: async () => ({
      resolved: 3,
      won: 2,
      lost: 1,
      voided: 0,
      diagnosable: ["w-loss"],
    }),
  },
});
mock.module("@/lib/jobs", {
  namedExports: { enqueueJob: async () => "job-1" },
});

before(async () => {
  process.env.CRON_SECRET = "test-secret";
  process.env.SAGE_WAGER_DIAGNOSIS_ENABLED = "";
  ({ POST } = await import("./route"));
});

describe("POST /api/internal/wagers/resolve", () => {
  it("401s without the bearer secret", async () => {
    const res = await POST(new Request("http://x/api/internal/wagers/resolve", { method: "POST" }));
    assert.equal(res.status, 401);
  });

  it("resolves due wagers with a valid secret", async () => {
    const res = await POST(
      new Request("http://x/api/internal/wagers/resolve", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resolved, 3);
    assert.equal(body.won, 2);
  });
});
