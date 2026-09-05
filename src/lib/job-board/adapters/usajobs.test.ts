import { describe, it, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { usajobsAdapter } from "./usajobs";
import { logger } from "@/lib/logger";

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
    let capturedAuthKey: string | null = null;
    let capturedUserAgent: string | null = null;
    let capturedHost: string | null = null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuthKey = headers.get("authorization-key");
      capturedUserAgent = headers.get("user-agent");
      capturedHost = headers.get("host");
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
    assert.equal(capturedAuthKey, "test-usajobs-key");
    assert.equal(capturedUserAgent, "test@example.com");
    assert.equal(capturedHost, "data.usajobs.gov");
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
    "skips one malformed item (MatchedObjectDescriptor undefined) and still returns the rest, logging exactly one {source, index} warning",
    async (t: TestContext) => {
      const warnMock = t.mock.method(logger, "warn", () => {});
      globalThis.fetch = async () =>
        mockSearchResponse([
          // The reviewer's own example: a real USAJobs row with the
          // descriptor missing. This round-trips through real JSON fine
          // (the property is simply absent); the throw happens when
          // normalization reads `desc.PositionTitle` off `undefined`.
          { MatchedObjectId: "bad" },
          {
            MatchedObjectId: "good",
            MatchedObjectDescriptor: {
              PositionTitle: "Office Assistant",
              OrganizationName: "Dept of Something",
              PositionLocationDisplay: "Beckley, WV",
              PositionRemuneration: [],
              QualificationSummary: "General office support.",
              PositionURI: "https://usajobs.gov/job/good",
            },
          },
        ]);

      const jobs = await usajobsAdapter.fetchJobs("WV", 25);

      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].sourceId, "usajobs:good");
      assert.equal(warnMock.mock.calls.length, 1);
      const [message, context] = warnMock.mock.calls[0].arguments;
      assert.equal(message, "Job source item failed to normalize");
      assert.deepEqual(context, { source: "usajobs", index: 0 });
    },
  );

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
