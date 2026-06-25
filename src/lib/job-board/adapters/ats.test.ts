import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_FETCH = globalThis.fetch;

function makeLeverResponse(jobs: unknown[]): Response {
  return new Response(JSON.stringify(jobs), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("leverAdapter", () => {
  // 1700000000000 ms = 2023-11-14T22:13:20.000Z  (NOT 1970)
  const LEVER_MS_TIMESTAMP = 1700000000000;

  let leverAdapter: Awaited<ReturnType<typeof import("./ats").leverAdapter.fetchJobs>> extends Array<infer T>
    ? { fetchJobs: (region: string) => Promise<T[]> }
    : never;

  before(async () => {
    const mod = await import("./ats");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    leverAdapter = mod.leverAdapter as any;
  });

  after(() => {
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
