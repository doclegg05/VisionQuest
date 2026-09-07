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

  // Before this, every RateIntervalCode other than "PA" was treated as
  // hourly ("hr"), so a per-week, per-day, per-month, or bi-weekly federal
  // listing had its raw range parsed as if it were an hourly wage —
  // off by one to two orders of magnitude in the min-pay filter and match
  // scoring. FB (fee basis) and PY/SY (school year) have no fixed-hours
  // convention at all and must resolve to no hourly rate while still
  // showing the raw range to the student.
  describe("RateIntervalCode → hourly rate", () => {
    function jobWithRemuneration(minimumRange: string, maximumRange: string, rateIntervalCode: string) {
      return {
        MatchedObjectId: `code-${rateIntervalCode}`,
        MatchedObjectDescriptor: {
          PositionTitle: "Test Position",
          OrganizationName: "Test Agency",
          PositionLocationDisplay: "Beckley, WV",
          PositionRemuneration: [{ MinimumRange: minimumRange, MaximumRange: maximumRange, RateIntervalCode: rateIntervalCode }],
          QualificationSummary: "Summary.",
          PositionURI: "https://usajobs.gov/job/x",
        },
      };
    }

    async function fetchOneWith(minimumRange: string, maximumRange: string, rateIntervalCode: string) {
      globalThis.fetch = async () =>
        mockSearchResponse([jobWithRemuneration(minimumRange, maximumRange, rateIntervalCode)]);
      const jobs = await usajobsAdapter.fetchJobs("WV", 25);
      assert.equal(jobs.length, 1);
      return jobs[0];
    }

    it("PA (per annum) resolves via the yearly period", async () => {
      const job = await fetchOneWith("41600", "45000", "PA");
      assert.equal(job.salaryMin, 20); // 41600 / 2080
      assert.match(job.salary ?? "", /41600/);
    });

    it("PH (per hour) resolves via the hourly period", async () => {
      const job = await fetchOneWith("15", "18", "PH");
      assert.equal(job.salaryMin, 15);
    });

    it("PD (per day) resolves via the daily period, not hourly", async () => {
      const job = await fetchOneWith("160", "200", "PD");
      assert.equal(job.salaryMin, 20); // 160 / 8, not 160
    });

    it("PW (per week) resolves via the weekly period, not hourly", async () => {
      const job = await fetchOneWith("600", "800", "PW");
      assert.equal(job.salaryMin, 15); // 600 / 40, not 600
    });

    it("PM (per month) resolves via the monthly period, not hourly", async () => {
      const job = await fetchOneWith("3000", "3500", "PM");
      assert.equal(job.salaryMin, 17.31); // 3000 / (2080/12), not 3000
    });

    it("BW (bi-weekly) resolves via the biweekly period, not hourly", async () => {
      const job = await fetchOneWith("2000", "2400", "BW");
      assert.equal(job.salaryMin, 25); // 2000 / 80, not 2000
    });

    it("FB (fee basis) has no fixed period — salaryMin is null, the raw amount is kept", async () => {
      const job = await fetchOneWith("500", "700", "FB");
      assert.equal(job.salaryMin, null);
      assert.match(job.salary ?? "", /500/);
    });

    it("PY (school year) has no fixed-hours convention — salaryMin is null, the raw amount is kept", async () => {
      const job = await fetchOneWith("41600", "45000", "PY");
      assert.equal(job.salaryMin, null);
      assert.match(job.salary ?? "", /41600/);
    });

    it("SY (school year) has no fixed-hours convention — salaryMin is null, the raw amount is kept", async () => {
      const job = await fetchOneWith("41600", "45000", "SY");
      assert.equal(job.salaryMin, null);
      assert.match(job.salary ?? "", /41600/);
    });

    it("an unrecognized RateIntervalCode is unknown, not assumed hourly", async () => {
      const job = await fetchOneWith("41600", "45000", "ZZ");
      assert.equal(job.salaryMin, null);
      assert.match(job.salary ?? "", /41600/);
    });
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
