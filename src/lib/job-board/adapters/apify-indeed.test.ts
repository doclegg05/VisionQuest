import { describe, it, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { apifyIndeedAdapter, buildIndeedTitleQueries, hourlyFromIndeedSalary } from "./apify-indeed";
import { logger } from "@/lib/logger";

const ORIGINAL_FETCH = globalThis.fetch;

/** run-sync-get-dataset-items returns the dataset items array directly. */
function mockItems(items: unknown[]): Response {
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Minimal row in the nested shape kaix/indeed-scraper emits. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    title: { text: "Certified Nursing Assistant, CNA" },
    company: { name: "Willows Center - WV" },
    location: { formatted: "Parkersburg, WV 26101" },
    description: { text: "Assist residents with activities of daily living." },
    urls: { indeed: "https://www.indeed.com/viewjob?jk=abc123" },
    dates: { posted: "2026-07-22" },
    salary: { text: "$16.50 - $18.00 an hour", min: 16.5, max: 18, exact: null, period: "hourly" },
    workArrangement: { isRemote: false },
    signals: { isExpired: false },
    requirements: { experienceLevel: "Entry level" },
    ...overrides,
  };
}

describe("hourlyFromIndeedSalary", () => {
  it("passes hourly rates through", () => {
    assert.equal(hourlyFromIndeedSalary({ min: 16.5, max: 18, period: "hourly" }), 16.5);
  });

  it("prefers min, falls back to exact, then max", () => {
    assert.equal(hourlyFromIndeedSalary({ exact: 22.66, period: "hourly" }), 22.66);
    assert.equal(hourlyFromIndeedSalary({ max: 20, period: "hourly" }), 20);
  });

  // The pilot dataset contained weekly, daily, and monthly pay. Feeding the raw
  // salary TEXT to parseSalaryToHourly reads "$400 - $800 a week" as $400/hour.
  it("converts weekly pay to an hourly rate", () => {
    assert.equal(hourlyFromIndeedSalary({ min: 400, max: 800, period: "weekly" }), 10);
    assert.equal(hourlyFromIndeedSalary({ min: 1500, max: 1800, period: "weekly" }), 37.5);
  });

  it("converts daily pay to an hourly rate", () => {
    assert.equal(hourlyFromIndeedSalary({ min: 215, period: "daily" }), 26.88);
  });

  it("converts monthly pay to an hourly rate", () => {
    assert.equal(hourlyFromIndeedSalary({ min: 2450, period: "monthly" }), 14.13);
  });

  it("converts yearly pay to an hourly rate", () => {
    assert.equal(hourlyFromIndeedSalary({ min: 85000, period: "yearly" }), 40.87);
  });

  it("returns null for missing or unrecognized periods", () => {
    assert.equal(hourlyFromIndeedSalary({ min: 20, period: null }), null);
    assert.equal(hourlyFromIndeedSalary({ min: 20, period: "per point" }), null);
    assert.equal(hourlyFromIndeedSalary(null), null);
    assert.equal(hourlyFromIndeedSalary({ period: "hourly" }), null);
  });

  it("rejects implausible hourly rates rather than coercing them", () => {
    assert.equal(hourlyFromIndeedSalary({ min: 0.4, period: "hourly" }), null);
    assert.equal(hourlyFromIndeedSalary({ min: 5000, period: "hourly" }), null);
    assert.equal(hourlyFromIndeedSalary({ min: -20, period: "hourly" }), null);
  });
});

describe("buildIndeedTitleQueries", () => {
  it("groups titles into Indeed advanced-syntax OR queries", () => {
    const queries = buildIndeedTitleQueries(["Caregiver", "CDL Driver"]);
    assert.equal(queries.length, 1);
    assert.equal(queries[0], 'title:("Caregiver" or "CDL Driver")');
  });

  it("splits long title lists into multiple queries", () => {
    const titles = Array.from({ length: 15 }, (_, i) => `Title ${i}`);
    const queries = buildIndeedTitleQueries(titles);
    assert.ok(queries.length >= 2, `expected multiple queries, got ${queries.length}`);
    for (const q of queries) assert.match(q, /^title:\(".+"\)$/);
  });

  it("strips embedded quotes that would break the query syntax", () => {
    const queries = buildIndeedTitleQueries(['Nurse "Aide"']);
    assert.equal(queries[0], 'title:("Nurse Aide")');
  });

  it("returns no queries for an empty title list", () => {
    assert.deepEqual(buildIndeedTitleQueries([]), []);
  });
});

describe("apify-indeed adapter", () => {
  beforeEach(() => {
    process.env.APIFY_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.APIFY_TOKEN;
  });

  it("is not configured without APIFY_TOKEN", () => {
    delete process.env.APIFY_TOKEN;
    assert.equal(apifyIndeedAdapter.isConfigured(), false);
  });

  it("returns [] when unconfigured", async () => {
    delete process.env.APIFY_TOKEN;
    assert.deepEqual(await apifyIndeedAdapter.fetchJobs("Charleston, WV", 25), []);
  });

  it("maps Indeed fields to NormalizedJob", async () => {
    globalThis.fetch = async () => mockItems([makeRow()]);

    const jobs = await apifyIndeedAdapter.fetchJobs("Parkersburg, WV", 25);
    const job = jobs.find((j) => j.sourceId === "apify-indeed:abc123");
    assert.ok(job, `expected mapped job, got ${JSON.stringify(jobs)}`);
    assert.equal(job?.title, "Certified Nursing Assistant, CNA");
    assert.equal(job?.company, "Willows Center - WV");
    assert.equal(job?.location, "Parkersburg, WV 26101");
    assert.equal(job?.source, "apify-indeed");
    assert.equal(job?.sourceType, "scrape");
    assert.equal(job?.url, "https://www.indeed.com/viewjob?jk=abc123");
    assert.equal(job?.salary, "$16.50 - $18.00 an hour");
    assert.equal(job?.salaryMin, 16.5);
    assert.equal(job?.postedAt, "2026-07-22");
    assert.equal(job?.workMode, "onsite");
  });

  it("sends the actor input and caps the spend", async (t: TestContext) => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    let capturedAuth: string | null = null;
    globalThis.fetch = async (input: unknown, init: RequestInit = {}) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init.headers).get("authorization");
      capturedBody = JSON.parse(String(init.body));
      return mockItems([]);
    };

    await apifyIndeedAdapter.fetchJobs("Beckley, WV", 25);

    assert.match(capturedUrl, /run-sync-get-dataset-items/);
    assert.match(capturedUrl, /maxTotalChargeUsd=/);
    assert.equal(capturedAuth, "Bearer test-token");
    assert.equal(capturedBody.location, "Beckley, WV");
    assert.equal(capturedBody.country, "US");
    assert.equal(capturedBody.radius, "25");
    assert.match(String(capturedBody.keyword), /^title:\(/);
    t.diagnostic(`actor input: ${JSON.stringify(capturedBody)}`);
  });

  it("never puts the API token in the request URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: unknown) => {
      capturedUrl = String(input);
      return mockItems([]);
    };

    await apifyIndeedAdapter.fetchJobs("WV", 25);
    assert.ok(
      !capturedUrl.includes("test-token"),
      `token leaked into request url: ${capturedUrl}`,
    );
  });

  it("snaps an arbitrary radius to a value the actor accepts", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_input: unknown, init: RequestInit = {}) => {
      capturedBody = JSON.parse(String(init.body));
      return mockItems([]);
    };

    await apifyIndeedAdapter.fetchJobs("WV", 30);
    assert.ok(
      ["0", "5", "10", "15", "25", "35", "50", "100"].includes(String(capturedBody.radius)),
      `radius ${capturedBody.radius} is not in the actor enum`,
    );
  });

  it("dedupes the same job key returned across grouped queries", async () => {
    globalThis.fetch = async () => mockItems([makeRow({ id: "dup" }), makeRow({ id: "dup" })]);
    const jobs = await apifyIndeedAdapter.fetchJobs("WV", 25);
    assert.equal(jobs.filter((j) => j.sourceId === "apify-indeed:dup").length, 1);
  });

  it("skips rows missing an id, title, or url", async () => {
    globalThis.fetch = async () =>
      mockItems([
        makeRow({ id: null }),
        makeRow({ id: "no-title", title: { text: "" } }),
        makeRow({ id: "no-url", urls: {} }),
        makeRow({ id: "good" }),
      ]);
    const jobs = await apifyIndeedAdapter.fetchJobs("WV", 25);
    assert.deepEqual(
      jobs.map((j) => j.sourceId),
      ["apify-indeed:good"],
    );
  });

  it("skips expired postings", async () => {
    globalThis.fetch = async () =>
      mockItems([makeRow({ id: "gone", signals: { isExpired: true } }), makeRow({ id: "live" })]);
    const jobs = await apifyIndeedAdapter.fetchJobs("WV", 25);
    assert.deepEqual(
      jobs.map((j) => j.sourceId),
      ["apify-indeed:live"],
    );
  });

  it("falls back to the external url when the indeed url is absent", async () => {
    globalThis.fetch = async () =>
      mockItems([makeRow({ urls: { external: "https://employer.example.com/apply" } })]);
    const jobs = await apifyIndeedAdapter.fetchJobs("WV", 25);
    assert.equal(jobs[0]?.url, "https://employer.example.com/apply");
  });

  it("leaves salaryMin null when the posting has no salary", async () => {
    globalThis.fetch = async () =>
      mockItems([makeRow({ salary: { text: null, min: null, max: null, exact: null, period: null } })]);
    const jobs = await apifyIndeedAdapter.fetchJobs("WV", 25);
    assert.equal(jobs[0]?.salary, null);
    assert.equal(jobs[0]?.salaryMin, null);
  });

  it("returns [] when the run times out or errors", async () => {
    globalThis.fetch = async () => new Response("timeout", { status: 408 });
    assert.deepEqual(await apifyIndeedAdapter.fetchJobs("WV", 25), []);
  });

  it("keeps results from queries that succeed when another fails", async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call += 1;
      if (call === 1) return new Response("boom", { status: 500 });
      return mockItems([makeRow({ id: "survivor" })]);
    };

    const jobs = await apifyIndeedAdapter.fetchJobs("WV", 25);
    assert.ok(
      jobs.some((j) => j.sourceId === "apify-indeed:survivor"),
      "a failing query should not discard results from the others",
    );
  });

  it("never logs the API token on failure", async (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    globalThis.fetch = async () => new Response("denied", { status: 401 });

    assert.deepEqual(await apifyIndeedAdapter.fetchJobs("WV", 25), []);
    for (const call of warnMock.mock.calls) {
      assert.ok(
        !JSON.stringify(call.arguments).includes("test-token"),
        `logged payload leaked APIFY_TOKEN: ${JSON.stringify(call.arguments)}`,
      );
    }
  });
});
