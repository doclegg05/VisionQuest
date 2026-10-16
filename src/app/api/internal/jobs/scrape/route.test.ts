import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import type { AutoRefreshSummary } from "@/lib/job-board/scrape-engine";

let POST: (req: Request) => Promise<Response>;

const CLEAN: AutoRefreshSummary = {
  totalJobs: 12,
  scrapedConfigs: 3,
  skippedConfigs: 1,
  failedConfigs: 0,
  unconfiguredConfigs: 0,
};
let runSweep: () => Promise<AutoRefreshSummary> = async () => CLEAN;
const captureMessage = mock.fn();
const errorLogs: unknown[] = [];

mock.module("@/lib/job-board/scrape-engine", {
  namedExports: { runAllAutoRefreshScrapes: () => runSweep() },
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
  runSweep = async () => CLEAN;
  captureMessage.mock.resetCalls();
  errorLogs.length = 0;
});

function authorizedRequest(): Request {
  return new Request("http://x/api/internal/jobs/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

describe("POST /api/internal/jobs/scrape", () => {
  it("401s without the bearer secret", async () => {
    const res = await POST(new Request("http://x/api/internal/jobs/scrape", { method: "POST" }));
    assert.equal(res.status, 401);
  });

  it("reports the sweep's counts", async () => {
    const res = await POST(authorizedRequest());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalJobs, 12);
    assert.equal(body.scrapedConfigs, 3);
    assert.equal(body.skippedConfigs, 1);
    assert.equal(body.failedConfigs, 0);
    assert.equal(captureMessage.mock.callCount(), 0);
  });

  it("stays 200 when classes only lack a configured source", async () => {
    runSweep = async () => ({ ...CLEAN, scrapedConfigs: 0, unconfiguredConfigs: 4 });

    const res = await POST(authorizedRequest());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).unconfiguredConfigs, 4);
    assert.equal(captureMessage.mock.callCount(), 0);
  });

  // pg_cron records every run as succeeded, and the nightly cron:health
  // check only sees HTTP statuses from the last six hours, so a Monday 10:05
  // failure would reach nobody. The route reports it to Sentry itself.
  it("answers 500 and reports to Sentry when any class failed, after the rest ran", async () => {
    runSweep = async () => ({ ...CLEAN, scrapedConfigs: 2, failedConfigs: 1 });

    const res = await POST(authorizedRequest());
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.failedConfigs, 1);
    assert.equal(body.scrapedConfigs, 2);
    assert.equal(captureMessage.mock.callCount(), 1);
    const [, context] = captureMessage.mock.calls[0].arguments as [string, { tags: Record<string, string> }];
    assert.equal(context.tags.jobname, "job-board-scrape");
  });

  it("answers 500 and reports to Sentry when the sweep itself throws, logging no message text", async () => {
    runSweep = async () => {
      throw Object.assign(new Error('Invalid `prisma.jobClassConfig.findMany()` invocation: where { autoRefresh: true }'), {
        code: "P1001",
      });
    };

    const res = await POST(authorizedRequest());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Job board scrape failed" });
    assert.equal(captureMessage.mock.callCount(), 1);
    assert.ok(!JSON.stringify(errorLogs).includes("Invalid `prisma"), "no raw Prisma message logged");
  });
});
