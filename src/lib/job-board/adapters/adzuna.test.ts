import { describe, it, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { adzunaAdapter } from "./adzuna";
import { logger } from "@/lib/logger";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ABORT_TIMEOUT = AbortSignal.timeout;

function mockResultsResponse(results: unknown[]): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("adzuna adapter", () => {
  beforeEach(() => {
    process.env.ADZUNA_APP_ID = "test-adzuna-app-id";
    process.env.ADZUNA_APP_KEY = "test-adzuna-app-key";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    AbortSignal.timeout = ORIGINAL_ABORT_TIMEOUT;
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
  });

  it("returns [] when unconfigured (missing app id or key)", async () => {
    delete process.env.ADZUNA_APP_KEY;
    assert.deepEqual(await adzunaAdapter.fetchJobs("Charleston, WV", 25), []);
  });

  it("maps Adzuna fields to NormalizedJob (query preserved)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return mockResultsResponse([
        {
          id: "a1",
          title: "Line Cook",
          company: { display_name: "Diner Co" },
          location: { display_name: "Beckley, WV" },
          salary_min: 30000,
          salary_max: 34000,
          description: "Prep and cook menu items.",
          redirect_url: "https://example.com/adzuna/a1",
        },
      ]);
    };

    const jobs = await adzunaAdapter.fetchJobs("Beckley, WV", 25);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].title, "Line Cook");
    assert.equal(jobs[0].sourceId, "adzuna:a1");
    assert.ok(capturedUrl.startsWith("https://api.adzuna.com/v1/api/jobs/us/search/1?"));
    assert.ok(capturedUrl.includes("app_id=test-adzuna-app-id"));
    assert.ok(capturedUrl.includes("app_key=test-adzuna-app-key"));
  });

  it("returns [] when the API errors", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.deepEqual(await adzunaAdapter.fetchJobs("WV", 25), []);
  });

  it("returns [] when fetch throws", async () => {
    globalThis.fetch = async () => {
      throw new Error("connection reset");
    };
    assert.deepEqual(await adzunaAdapter.fetchJobs("WV", 25), []);
  });

  it("VQ-R-019: passes an AbortSignal to fetch so a hung request cannot block the sweep forever", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return mockResultsResponse([]);
    };

    await adzunaAdapter.fetchJobs("Charleston, WV", 25);

    assert.ok(capturedSignal instanceof AbortSignal, "expected fetch to receive an AbortSignal");
  });

  it(
    "skips one malformed item and still returns the rest, logging exactly one {source, index} warning",
    async (t: TestContext) => {
      const warnMock = t.mock.method(logger, "warn", () => {});
      // As in jsearch.test.ts: a getter that throws on access simulates a
      // genuinely corrupt row without going through real JSON serialization
      // (JSON.stringify would itself throw on a throwing getter), by
      // returning a Response-shaped object whose `.json()` resolves
      // directly to the raw values — fetchJson only ever calls `.ok` and
      // `.json()` on what fetch() returns.
      const malformed = {
        get title() {
          throw new Error("corrupt row");
        },
        id: "bad",
      };
      const good = {
        id: "good",
        title: "Line Cook",
        company: { display_name: "Diner Co" },
        location: { display_name: "Beckley, WV" },
        salary_min: null,
        salary_max: null,
        description: "Prep and cook menu items.",
        redirect_url: "https://example.com/adzuna/good",
      };
      globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({ results: [malformed, good] }),
      })) as unknown as typeof fetch;

      const jobs = await adzunaAdapter.fetchJobs("Beckley, WV", 25);

      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].sourceId, "adzuna:good");
      assert.equal(warnMock.mock.calls.length, 1);
      const [message, context] = warnMock.mock.calls[0].arguments;
      assert.equal(message, "Job source item failed to normalize");
      assert.deepEqual(context, { source: "adzuna", index: 0 });
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

      const promise = adzunaAdapter.fetchJobs("Charleston, WV", 25);
      controller.abort();
      const jobs = await promise;

      assert.deepEqual(jobs, []);
    },
  );

  function assertWarnLogsAreCredentialFree(
    warnMock: ReturnType<TestContext["mock"]["method"]>,
  ): void {
    assert.ok(warnMock.mock.calls.length > 0, "expected at least one warn log on failure");
    for (const call of warnMock.mock.calls) {
      const serialized = JSON.stringify(call.arguments);
      assert.ok(
        !serialized.includes("test-adzuna-app-id"),
        `logged payload leaked ADZUNA_APP_ID: ${serialized}`,
      );
      assert.ok(
        !serialized.includes("test-adzuna-app-key"),
        `logged payload leaked ADZUNA_APP_KEY: ${serialized}`,
      );
      assert.ok(
        serialized.includes("redacted") && !serialized.includes(process.env.ADZUNA_APP_ID ?? "\0"),
        `expected a redacted placeholder in the logged url: ${serialized}`,
      );
    }
  }

  it("never logs app_id/app_key on a non-2xx response (they ride in the query string)", async (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    globalThis.fetch = async () => new Response("denied", { status: 403 });

    assert.deepEqual(await adzunaAdapter.fetchJobs("WV", 25), []);
    assertWarnLogsAreCredentialFree(warnMock);
  });

  it("never logs app_id/app_key when fetch throws", async (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    globalThis.fetch = async () => {
      throw new Error("connection reset");
    };

    assert.deepEqual(await adzunaAdapter.fetchJobs("WV", 25), []);
    assertWarnLogsAreCredentialFree(warnMock);
  });
});
