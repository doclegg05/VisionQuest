import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";

let POST: (req: Request) => Promise<Response>;

let roster: () => Promise<Array<{ id: string }>> = async () => [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
let sweep: (ids: string[]) => Promise<{ synced: number; failed: number }> = async (ids) => ({
  synced: ids.length,
  failed: 0,
});
const captureMessage = mock.fn();
const errorLogs: unknown[] = [];

mock.module("@/lib/db", {
  namedExports: { prismaAdmin: { student: { findMany: () => roster() } } },
});
mock.module("@/lib/advising", {
  namedExports: { syncAlertsForStudents: (ids: string[]) => sweep(ids) },
});
mock.module("@sentry/nextjs", { namedExports: { captureMessage } });
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      info: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      error: (message: string, context: unknown) => errorLogs.push({ message, context }),
    },
  },
});

before(async () => {
  process.env.CRON_SECRET = "test-secret";
  ({ POST } = await import("./route"));
});

afterEach(() => {
  roster = async () => [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
  sweep = async (ids) => ({ synced: ids.length, failed: 0 });
  captureMessage.mock.resetCalls();
  errorLogs.length = 0;
});

function authorizedRequest(): Request {
  return new Request("http://x/api/internal/alerts/sync", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

describe("POST /api/internal/alerts/sync", () => {
  it("401s without the bearer secret", async () => {
    const res = await POST(new Request("http://x/api/internal/alerts/sync", { method: "POST" }));
    assert.equal(res.status, 401);
  });

  it("syncs every active student and reports the counts", async () => {
    const res = await POST(authorizedRequest());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.synced, 3);
    assert.equal(body.failed, 0);
    assert.equal(captureMessage.mock.callCount(), 0);
  });

  // The daily 10:25 run is outside the nightly cron:health window, so a
  // failed sweep reports itself to Sentry.
  it("answers 500 and reports to Sentry when any student failed", async () => {
    sweep = async () => ({ synced: 2, failed: 1 });

    const res = await POST(authorizedRequest());
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.synced, 2);
    assert.equal(body.failed, 1);
    assert.equal(captureMessage.mock.callCount(), 1);
    const [, context] = captureMessage.mock.calls[0].arguments as [string, { tags: Record<string, string> }];
    assert.equal(context.tags.jobname, "alert-sync");
  });

  it("answers 500 and reports to Sentry when the roster read throws, logging no message text", async () => {
    roster = async () => {
      throw Object.assign(new Error('Invalid `prisma.student.findMany()` invocation: where { role: "student" }'), {
        code: "P1001",
      });
    };

    const res = await POST(authorizedRequest());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Alert sync failed" });
    assert.equal(captureMessage.mock.callCount(), 1);
    assert.ok(!JSON.stringify(errorLogs).includes("Invalid `prisma"), "no raw Prisma message logged");
  });
});
