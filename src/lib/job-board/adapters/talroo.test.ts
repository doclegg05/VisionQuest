import { describe, it, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { talrooAdapter, mapTalrooJob } from "./talroo";
import { logger } from "@/lib/logger";

const ORIGINAL_FETCH = globalThis.fetch;

function mockJobsResponse(jobs: unknown[]): Response {
  return new Response(JSON.stringify({ jobs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("talroo adapter", () => {
  beforeEach(() => {
    process.env.TALROO_API_KEY = "test-talroo-key";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.TALROO_API_KEY;
  });

  it("is not configured without TALROO_API_KEY", () => {
    delete process.env.TALROO_API_KEY;
    assert.equal(talrooAdapter.isConfigured(), false);
  });

  it("is configured when TALROO_API_KEY is present", () => {
    assert.equal(talrooAdapter.isConfigured(), true);
  });

  it("returns [] when unconfigured, without ever calling fetch", async () => {
    delete process.env.TALROO_API_KEY;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return mockJobsResponse([]);
    };
    assert.deepEqual(await talrooAdapter.fetchJobs("Charleston, WV", 25), []);
    assert.equal(fetchCalled, false);
  });

  it("maps Talroo fields to NormalizedJob, including structured salary_details", async () => {
    globalThis.fetch = async () =>
      mockJobsResponse([
        {
          id: "abc1",
          title: "Warehouse Associate",
          company: "Mountain Metal",
          city: "Beckley",
          state: "WV",
          description: "Pick, pack, and ship orders in a busy distribution center.",
          url: "https://click.talroo.com/track/abc1?src=publisher",
          posted_at: "2026-09-01T00:00:00.000Z",
          salary_details: { min: 15, max: 18, period: "hour" },
        },
      ]);

    const jobs = await talrooAdapter.fetchJobs("Beckley, WV", 25);
    const job = jobs.find((j) => j.sourceId === "talroo:abc1");
    assert.ok(job, "expected a mapped job for talroo:abc1");
    assert.equal(job?.title, "Warehouse Associate");
    assert.equal(job?.company, "Mountain Metal");
    assert.equal(job?.location, "Beckley, WV");
    assert.equal(job?.source, "talroo");
    assert.equal(job?.sourceType, "api");
    assert.equal(job?.postedAt, "2026-09-01T00:00:00.000Z");
    // parseSalaryToHourly takes the floor of a range as the conservative
    // figure to filter and score on (matches every other adapter's contract).
    assert.equal(job?.salaryMin, 15);
    assert.equal(job?.salary, "$15-$18/hour");
  });

  it("keeps Talroo's tracking URL byte-for-byte as `url` (publisher terms require clicks route through it)", async () => {
    const trackingUrl = "https://click.talroo.com/track/xyz9?src=publisher&campaign=spokes&utm=1";
    globalThis.fetch = async () =>
      mockJobsResponse([
        {
          id: "xyz9",
          title: "CDL Driver",
          company: "Valley Freight",
          city: "Charleston",
          state: "WV",
          description: "Local routes, home nightly.",
          url: trackingUrl,
        },
      ]);

    const jobs = await talrooAdapter.fetchJobs("Charleston, WV", 25);
    const job = jobs.find((j) => j.sourceId === "talroo:xyz9");
    assert.equal(job?.url, trackingUrl);
  });

  it("dedupes the same id returned across keyword queries", async () => {
    globalThis.fetch = async () =>
      mockJobsResponse([
        {
          id: "dup",
          title: "Caregiver",
          company: "Home Care",
          city: "Beckley",
          state: "WV",
          description: "Assist clients with daily living tasks.",
          url: "https://click.talroo.com/track/dup",
        },
      ]);
    const jobs = await talrooAdapter.fetchJobs("WV", 25);
    assert.equal(jobs.filter((j) => j.sourceId === "talroo:dup").length, 1);
  });

  it("returns [] when the API errors", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.deepEqual(await talrooAdapter.fetchJobs("WV", 25), []);
  });

  it("returns [] when fetch throws", async () => {
    globalThis.fetch = async () => {
      throw new Error("connection reset");
    };
    assert.deepEqual(await talrooAdapter.fetchJobs("WV", 25), []);
  });

  function assertWarnLogsAreCredentialFree(
    warnMock: ReturnType<TestContext["mock"]["method"]>,
  ): void {
    for (const call of warnMock.mock.calls) {
      const serialized = JSON.stringify(call.arguments);
      assert.ok(
        !serialized.includes("test-talroo-key"),
        `logged payload leaked TALROO_API_KEY: ${serialized}`,
      );
    }
  }

  it("never logs the configured API key on a non-2xx response", async (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    globalThis.fetch = async () => new Response("denied", { status: 403 });

    assert.deepEqual(await talrooAdapter.fetchJobs("WV", 25), []);
    assertWarnLogsAreCredentialFree(warnMock);
  });

  it("never logs the configured API key when fetch throws", async (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    globalThis.fetch = async () => {
      throw new Error("connection reset");
    };

    assert.deepEqual(await talrooAdapter.fetchJobs("WV", 25), []);
    assertWarnLogsAreCredentialFree(warnMock);
  });

  it("sends the Talroo API key as a Bearer Authorization header, never in the URL", async (t: TestContext) => {
    let capturedUrl = "";
    let capturedAuth: string | null = null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get("authorization");
      return mockJobsResponse([]);
    };

    await talrooAdapter.fetchJobs("Charleston, WV", 25);

    assert.ok(!capturedUrl.includes("test-talroo-key"), "API key leaked into the request URL");
    assert.equal(capturedAuth, "Bearer test-talroo-key");
  });
});

describe("mapTalrooJob", () => {
  it("drops a job missing id, title, or url", () => {
    assert.equal(mapTalrooJob({ title: "t", url: "https://x" }, "WV"), null);
    assert.equal(mapTalrooJob({ id: "1", url: "https://x" }, "WV"), null);
    assert.equal(mapTalrooJob({ id: "1", title: "t" }, "WV"), null);
  });

  it("falls back to the class region when city/state are absent", () => {
    const job = mapTalrooJob(
      { id: "1", title: "Cashier", company: "Corner Store", url: "https://x" },
      "Charleston, WV",
    );
    assert.equal(job?.location, "Charleston, WV");
  });

  it("leaves salary null when salary_details is absent", () => {
    const job = mapTalrooJob({ id: "1", title: "Cashier", url: "https://x" }, "WV");
    assert.equal(job?.salary, null);
    assert.equal(job?.salaryMin, null);
  });
});
