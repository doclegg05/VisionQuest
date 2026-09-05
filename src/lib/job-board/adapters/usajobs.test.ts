import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { usajobsAdapter } from "./usajobs";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ABORT_TIMEOUT = AbortSignal.timeout;

function mockSearchResponse(items: unknown[]): Response {
  return new Response(JSON.stringify({ SearchResult: { SearchResultItems: items } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("usajobs adapter", () => {
  beforeEach(() => {
    process.env.USAJOBS_API_KEY = "test-usajobs-key";
    process.env.USAJOBS_EMAIL = "test@example.com";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    AbortSignal.timeout = ORIGINAL_ABORT_TIMEOUT;
    delete process.env.USAJOBS_API_KEY;
    delete process.env.USAJOBS_EMAIL;
  });

  it("returns [] when unconfigured (missing key or email)", async () => {
    delete process.env.USAJOBS_EMAIL;
    assert.deepEqual(await usajobsAdapter.fetchJobs("Charleston, WV", 25), []);
  });

  it("maps USAJobs fields to NormalizedJob (headers/query preserved)", async () => {
    let capturedUrl = "";
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return mockSearchResponse([
        {
          MatchedObjectId: "u1",
          MatchedObjectDescriptor: {
            PositionTitle: "Office Assistant",
            OrganizationName: "Dept of Something",
            PositionLocationDisplay: "Beckley, WV",
            PositionRemuneration: [{ MinimumRange: "15", MaximumRange: "18", RateIntervalCode: "PH" }],
            QualificationSummary: "General office support.",
            PositionURI: "https://usajobs.gov/job/u1",
          },
        },
      ]);
    };

    const jobs = await usajobsAdapter.fetchJobs("Beckley, WV", 25);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].title, "Office Assistant");
    assert.equal(jobs[0].sourceId, "usajobs:u1");
    assert.ok(capturedUrl.startsWith("https://data.usajobs.gov/api/search?"));
    assert.ok(capturedUrl.includes("LocationName=Beckley%2C+WV") || capturedUrl.includes("LocationName=Beckley%2C%20WV"));
    assert.equal(capturedHeaders?.get("authorization-key"), "test-usajobs-key");
    assert.equal(capturedHeaders?.get("user-agent"), "test@example.com");
    assert.equal(capturedHeaders?.get("host"), "data.usajobs.gov");
  });

  it("returns [] when the API errors", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.deepEqual(await usajobsAdapter.fetchJobs("WV", 25), []);
  });

  it("returns [] when fetch throws", async () => {
    globalThis.fetch = async () => {
      throw new Error("connection reset");
    };
    assert.deepEqual(await usajobsAdapter.fetchJobs("WV", 25), []);
  });

  it("VQ-R-019: passes an AbortSignal to fetch so a hung request cannot block the sweep forever", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return mockSearchResponse([]);
    };

    await usajobsAdapter.fetchJobs("Charleston, WV", 25);

    assert.ok(capturedSignal instanceof AbortSignal, "expected fetch to receive an AbortSignal");
  });

  it(
    "VQ-R-019: returns [] rather than hanging forever when the request's own timeout fires",
    { timeout: 2000 },
    async () => {
      const controller = new AbortController();
      AbortSignal.timeout = () => controller.signal;

      globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          const rejectWithAbort = () => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (signal?.aborted) {
            rejectWithAbort();
            return;
          }
          signal?.addEventListener("abort", rejectWithAbort);
        });

      const promise = usajobsAdapter.fetchJobs("Charleston, WV", 25);
      controller.abort();
      const jobs = await promise;

      assert.deepEqual(jobs, []);
    },
  );
});
