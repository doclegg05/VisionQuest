import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import type { AutoRefreshSummary } from "@/lib/job-board/scrape-engine";

let POST: (req: Request) => Promise<Response>;

const CLEAN: AutoRefreshSummary = { totalJobs: 12, scrapedConfigs: 3, skippedConfigs: 1, failedConfigs: 0 };
let summary: AutoRefreshSummary = CLEAN;

mock.module("@/lib/job-board/scrape-engine", {
  namedExports: { runAllAutoRefreshScrapes: async () => summary },
});

before(async () => {
  process.env.CRON_SECRET = "test-secret";
  ({ POST } = await import("./route"));
});

afterEach(() => {
  summary = CLEAN;
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
  });

  // pg_cron records every run as succeeded; only the HTTP status reaches
  // net._http_response, which is what npm run cron:health reads.
  it("answers 500 when any class failed, after the rest ran", async () => {
    summary = { totalJobs: 8, scrapedConfigs: 2, skippedConfigs: 0, failedConfigs: 1 };

    const res = await POST(authorizedRequest());
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.failedConfigs, 1);
    assert.equal(body.scrapedConfigs, 2);
  });
});
