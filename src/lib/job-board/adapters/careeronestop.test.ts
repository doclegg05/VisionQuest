import { describe, it, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { careerOneStopAdapter } from "./careeronestop";
import { logger } from "@/lib/logger";

const ORIGINAL_FETCH = globalThis.fetch;

function mockJobsResponse(jobs: unknown[]): Response {
  return new Response(JSON.stringify({ Jobs: jobs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("careeronestop adapter", () => {
  beforeEach(() => {
    process.env.COS_USER_ID = "test-user";
    process.env.COS_API_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.COS_USER_ID;
    delete process.env.COS_API_TOKEN;
  });

  it("is not configured without env credentials", () => {
    delete process.env.COS_USER_ID;
    assert.equal(careerOneStopAdapter.isConfigured(), false);
  });

  it("returns [] when unconfigured", async () => {
    delete process.env.COS_API_TOKEN;
    assert.deepEqual(await careerOneStopAdapter.fetchJobs("Charleston, WV", 25), []);
  });

  it("maps CareerOneStop fields to NormalizedJob", async () => {
    globalThis.fetch = async () =>
      mockJobsResponse([
        {
          JvId: "abc1",
          JobTitle: "Administrative Assistant",
          Company: "Acme Co",
          Location: "Charleston, WV",
          URL: "https://example.com/job/abc1",
          Description: "Front desk and scheduling support for a busy office.",
        },
      ]);

    const jobs = await careerOneStopAdapter.fetchJobs("Charleston, WV", 25);
    const job = jobs.find((j) => j.sourceId === "careeronestop:abc1");
    assert.ok(job);
    assert.equal(job?.title, "Administrative Assistant");
    assert.equal(job?.company, "Acme Co");
    assert.equal(job?.source, "careeronestop");
    assert.equal(job?.sourceType, "api");
    assert.equal(job?.salary, null);
    assert.equal(job?.url, "https://example.com/job/abc1");
  });

  it("dedupes the same JvId returned across keyword queries", async () => {
    globalThis.fetch = async () =>
      mockJobsResponse([
        { JvId: "dup", JobTitle: "Caregiver", Company: "Home Care", Location: "Beckley, WV", URL: "https://example.com/dup", Description: "Assist clients with daily living tasks." },
      ]);
    const jobs = await careerOneStopAdapter.fetchJobs("WV", 25);
    assert.equal(jobs.filter((j) => j.sourceId === "careeronestop:dup").length, 1);
  });

  it("returns [] when the API errors", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.deepEqual(await careerOneStopAdapter.fetchJobs("WV", 25), []);
  });

  function assertWarnLogsAreCredentialFree(
    warnMock: ReturnType<TestContext["mock"]["method"]>,
  ): void {
    assert.ok(warnMock.mock.calls.length > 0, "expected at least one warn log on failure");
    for (const call of warnMock.mock.calls) {
      const serialized = JSON.stringify(call.arguments);
      assert.ok(
        !serialized.includes("test-user"),
        `logged payload leaked COS_USER_ID: ${serialized}`,
      );
      assert.ok(
        serialized.includes("[cos-user]"),
        `expected redacted user-id segment in logged url: ${serialized}`,
      );
    }
  }

  it("never logs the configured user id on a non-2xx response", async (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    globalThis.fetch = async () => new Response("denied", { status: 403 });

    assert.deepEqual(await careerOneStopAdapter.fetchJobs("WV", 25), []);
    assertWarnLogsAreCredentialFree(warnMock);
  });

  it("never logs the configured user id when fetch throws", async (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    globalThis.fetch = async () => {
      throw new Error("connection reset");
    };

    assert.deepEqual(await careerOneStopAdapter.fetchJobs("WV", 25), []);
    assertWarnLogsAreCredentialFree(warnMock);
  });
});

describe("careeronestop adapter — WorkForce WV pass", () => {
  beforeEach(() => {
    process.env.COS_USER_ID = "test-user";
    process.env.COS_API_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.COS_USER_ID;
    delete process.env.COS_API_TOKEN;
  });

  function captureRequests(jobsFor: (url: string) => unknown[]): string[] {
    const urls: string[] = [];
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      return mockJobsResponse(jobsFor(url));
    };
    return urls;
  }

  it("requests WorkForce WV postings by company name before any title pass", async () => {
    const urls = captureRequests(() => []);
    await careerOneStopAdapter.fetchJobs("Charleston, WV", 25);

    const wvPass = urls[0];
    assert.ok(wvPass, "expected at least one request");
    assert.ok(
      wvPass.includes("companyName=West%20Virginia%20Employer"),
      `first request must filter by the WorkForce WV label: ${wvPass}`,
    );
    // keyword "0" = every posting in the location, per the CareerOneStop docs
    assert.ok(
      wvPass.includes("/test-user/0/Charleston%2C%20WV/25/"),
      `WV pass must use the all-jobs keyword for the region: ${wvPass}`,
    );
    assert.equal(
      urls.slice(1).filter((u) => u.includes("companyName=")).length,
      0,
      "title passes must not carry the company filter",
    );
  });

  it("keeps WorkForce WV postings even when title passes fill the result cap", async () => {
    let counter = 0;
    captureRequests((url) => {
      if (url.includes("companyName=")) {
        return [
          { JvId: "wv-1", JobTitle: "Production Associate", Company: "West Virginia Employer", Location: "Charleston, WV", URL: "https://de.jobsyn.org/wv-1", Description: "Assemble and inspect product." },
        ];
      }
      // Every title pass returns a full page of distinct jobs.
      return Array.from({ length: 20 }, () => {
        counter += 1;
        return { JvId: `t-${counter}`, JobTitle: `Job ${counter}`, Company: "Acme Co", Location: "Charleston, WV", URL: `https://example.com/${counter}`, Description: "Work." };
      });
    });

    const jobs = await careerOneStopAdapter.fetchJobs("Charleston, WV", 25);
    assert.ok(jobs.some((j) => j.sourceId === "careeronestop:wv-1"));
    assert.ok(jobs.length > 60, "WV postings are additive to the title-pass cap");
  });

  it("does not double-count a WV posting that a title pass also returns", async () => {
    const row = { JvId: "wv-dup", JobTitle: "Caregiver", Company: "West Virginia Employer", Location: "Beckley, WV", URL: "https://de.jobsyn.org/wv-dup", Description: "Care." };
    captureRequests(() => [row]);
    const jobs = await careerOneStopAdapter.fetchJobs("Beckley, WV", 25);
    assert.equal(jobs.filter((j) => j.sourceId === "careeronestop:wv-dup").length, 1);
  });

  it("still returns title-pass results when the WV pass fails", async () => {
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("companyName=")) return new Response("nope", { status: 500 });
      return mockJobsResponse([
        { JvId: "ok-1", JobTitle: "Cashier", Company: "Acme Co", Location: "WV", URL: "https://example.com/ok-1", Description: "Ring up sales." },
      ]);
    };
    const jobs = await careerOneStopAdapter.fetchJobs("WV", 25);
    assert.ok(jobs.some((j) => j.sourceId === "careeronestop:ok-1"));
  });
});
