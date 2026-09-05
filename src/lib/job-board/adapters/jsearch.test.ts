import { describe, it, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { jsearchAdapter } from "./jsearch";
import { logger } from "@/lib/logger";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ABORT_TIMEOUT = AbortSignal.timeout;

function mockSearchResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("jsearch adapter", () => {
  beforeEach(() => {
    process.env.JSEARCH_API_KEY = "test-jsearch-key";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    AbortSignal.timeout = ORIGINAL_ABORT_TIMEOUT;
    delete process.env.JSEARCH_API_KEY;
  });

  it("returns [] when unconfigured", async () => {
    delete process.env.JSEARCH_API_KEY;
    assert.deepEqual(await jsearchAdapter.fetchJobs("Charleston, WV", 25), []);
  });

  it("maps JSearch fields to NormalizedJob (headers/query preserved)", async () => {
    let capturedUrl = "";
    let capturedRapidApiKey: string | null = null;
    let capturedRapidApiHost: string | null = null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedRapidApiKey = headers.get("x-rapidapi-key");
      capturedRapidApiHost = headers.get("x-rapidapi-host");
      return mockSearchResponse([
        {
          job_id: "j1",
          job_title: "Retail Associate",
          employer_name: "Corner Store",
          job_city: "Beckley",
          job_state: "WV",
          job_min_salary: 15,
          job_max_salary: 17,
          job_salary_currency: "USD",
          job_salary_period: "hour",
          job_description: "Stock shelves and help customers.",
          job_apply_link: "https://example.com/apply/j1",
        },
      ]);
    };

    const jobs = await jsearchAdapter.fetchJobs("Beckley, WV", 25);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].title, "Retail Associate");
    assert.equal(jobs[0].sourceId, "jsearch:j1");
    assert.ok(capturedUrl.includes("jsearch.p.rapidapi.com/search"));
    assert.ok(capturedUrl.includes("query=jobs+in+Beckley%2C+WV") || capturedUrl.includes("query=jobs%20in%20Beckley%2C%20WV"));
    assert.equal(capturedRapidApiKey, "test-jsearch-key");
    assert.equal(capturedRapidApiHost, "jsearch.p.rapidapi.com");
  });

  it("returns [] when the API errors", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.deepEqual(await jsearchAdapter.fetchJobs("WV", 25), []);
  });

  it("returns [] when fetch throws", async () => {
    globalThis.fetch = async () => {
      throw new Error("connection reset");
    };
    assert.deepEqual(await jsearchAdapter.fetchJobs("WV", 25), []);
  });

  it("VQ-R-019: passes an AbortSignal to fetch so a hung request cannot block the sweep forever", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return mockSearchResponse([]);
    };

    await jsearchAdapter.fetchJobs("Charleston, WV", 25);

    assert.ok(capturedSignal instanceof AbortSignal, "expected fetch to receive an AbortSignal");
  });

  it(
    "skips one malformed item and still returns the rest, logging exactly one {source, index} warning",
    async (t: TestContext) => {
      const warnMock = t.mock.method(logger, "warn", () => {});
      // A getter that throws on access simulates a genuinely corrupt row
      // (the same class of failure as the reviewer's example: a USAJobs
      // MatchedObjectDescriptor being undefined and property access
      // throwing during normalization). JSON.stringify would itself throw
      // on a getter like this, so this bypasses real serialization by
      // returning a Response-shaped object whose `.json()` resolves
      // directly to the raw values fetchJson reads — `fetchJson` only ever
      // calls `.ok` and `.json()` on what fetch() returns.
      const malformed = {
        get job_title() {
          throw new Error("corrupt row");
        },
        job_id: "bad",
      };
      const good = {
        job_id: "good",
        job_title: "Retail Associate",
        employer_name: "Corner Store",
        job_city: "Beckley",
        job_state: "WV",
        job_min_salary: null,
        job_max_salary: null,
        job_salary_currency: null,
        job_salary_period: null,
        job_description: "Stock shelves.",
        job_apply_link: "https://example.com/apply/good",
      };
      globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({ data: [malformed, good] }),
      })) as unknown as typeof fetch;

      const jobs = await jsearchAdapter.fetchJobs("Beckley, WV", 25);

      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].sourceId, "jsearch:good");
      assert.equal(warnMock.mock.calls.length, 1);
      const [message, context] = warnMock.mock.calls[0].arguments;
      assert.equal(message, "Job source item failed to normalize");
      assert.deepEqual(context, { source: "jsearch", index: 0 });
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

      const promise = jsearchAdapter.fetchJobs("Charleston, WV", 25);
      controller.abort();
      const jobs = await promise;

      assert.deepEqual(jobs, []);
    },
  );
});
