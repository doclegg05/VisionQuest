import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { careerOneStopAdapter } from "./careeronestop";

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
});
