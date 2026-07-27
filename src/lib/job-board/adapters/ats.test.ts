import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_FETCH = globalThis.fetch;

function makeLeverResponse(jobs: unknown[]): Response {
  return new Response(JSON.stringify(jobs), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// =============================================================================
// VQ-R-015 — the ATS adapters shipped hardcoded elite-tech boards (airbnb,
// anthropic, stripe, openai, ...) into the default browse pool. Boards are now
// opt-in via GREENHOUSE_BOARDS / LEVER_BOARDS / ASHBY_BOARDS env vars; with
// nothing configured the adapters report unconfigured and fetch nothing.
// =============================================================================
describe("ATS board defaults (VQ-R-015)", () => {
  before(() => {
    delete process.env.GREENHOUSE_BOARDS;
    delete process.env.LEVER_BOARDS;
    delete process.env.ASHBY_BOARDS;
  });

  after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("greenhouse/lever/ashby are unconfigured with no env opt-in", async () => {
    const { greenhouseAdapter, leverAdapter, ashbyAdapter } = await import("./ats");
    assert.equal(greenhouseAdapter.isConfigured(), false);
    assert.equal(leverAdapter.isConfigured(), false);
    assert.equal(ashbyAdapter.isConfigured(), false);
  });

  it("fetches no boards (zero network calls) with no env opt-in", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return makeLeverResponse([]);
    };
    const { greenhouseAdapter, leverAdapter, ashbyAdapter } = await import("./ats");
    assert.deepEqual(await greenhouseAdapter.fetchJobs("", 0), []);
    assert.deepEqual(await leverAdapter.fetchJobs("", 0), []);
    assert.deepEqual(await ashbyAdapter.fetchJobs("", 0), []);
    assert.equal(calls, 0);
  });

  it("the default browse pool contains no ATS elite-board adapters", async () => {
    const { browseAdapters } = await import("../browse-sources");
    const sources = browseAdapters().map((adapter) => adapter.source);
    assert.ok(!sources.includes("greenhouse"));
    assert.ok(!sources.includes("lever"));
    assert.ok(!sources.includes("ashby"));
  });

  it("a deployment can still opt a board in via env", async () => {
    process.env.GREENHOUSE_BOARDS = "localhealthco, acme-logistics";
    try {
      const { greenhouseAdapter } = await import("./ats");
      assert.equal(greenhouseAdapter.isConfigured(), true);

      const requested: string[] = [];
      globalThis.fetch = async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return makeLeverResponse([]);
      };
      // Greenhouse response shape is { jobs: [] } — an empty jobs array is fine.
      await greenhouseAdapter.fetchJobs("", 0);
      assert.equal(requested.length, 2);
      assert.ok(requested[0].includes("/boards/localhealthco/"));
      assert.ok(requested[1].includes("/boards/acme-logistics/"));
    } finally {
      delete process.env.GREENHOUSE_BOARDS;
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });
});

describe("leverAdapter", () => {
  // 1700000000000 ms = 2023-11-14T22:13:20.000Z  (NOT 1970)
  const LEVER_MS_TIMESTAMP = 1700000000000;

  let leverAdapter: Awaited<ReturnType<typeof import("./ats").leverAdapter.fetchJobs>> extends Array<infer T>
    ? { fetchJobs: (region: string) => Promise<T[]> }
    : never;

  before(async () => {
    // VQ-R-015: boards are env opt-in now; these timestamp tests need one board.
    process.env.LEVER_BOARDS = "wealthfront";
    const mod = await import("./ats");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    leverAdapter = mod.leverAdapter as any;
  });

  after(() => {
    delete process.env.LEVER_BOARDS;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("createdAt unix-ms resolves to 2023-11, not 1970", async () => {
    globalThis.fetch = async () =>
      makeLeverResponse([
        {
          id: "abc-123",
          text: "Software Engineer",
          hostedUrl: "https://jobs.lever.co/wealthfront/abc-123",
          descriptionPlain: "Build great things.",
          description: "<p>Build great things.</p>",
          categories: { location: "Remote" },
          createdAt: LEVER_MS_TIMESTAMP,
        },
      ]);

    const jobs = await leverAdapter.fetchJobs("");
    assert.equal(jobs.length, 1);
    const postedAt = jobs[0]?.postedAt;
    assert.ok(postedAt, "postedAt should be defined");
    assert.ok(
      postedAt!.startsWith("2023-11"),
      `Expected postedAt to start with "2023-11" (unix-ms), got: ${postedAt}`,
    );
  });

  it("returns undefined postedAt when createdAt is null", async () => {
    globalThis.fetch = async () =>
      makeLeverResponse([
        {
          id: "xyz-456",
          text: "Data Analyst",
          hostedUrl: "https://jobs.lever.co/wealthfront/xyz-456",
          descriptionPlain: "Analyze data.",
          categories: { location: "Remote" },
          createdAt: null,
        },
      ]);

    const jobs = await leverAdapter.fetchJobs("");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.postedAt, undefined);
  });
});
