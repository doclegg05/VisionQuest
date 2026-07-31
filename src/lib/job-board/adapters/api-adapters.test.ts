/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
// =============================================================================
// VQ-R-019 — the three keyed API adapters (adzuna, usajobs, jsearch) must go
// through shared fetchJson, which carries the 30s AbortSignal timeout and
// failure logging. A raw fetch with no timeout can hang a scrape run forever.
//
// These tests mock ./shared and assert each adapter routes its request through
// fetchJson (the timeout wiring) and degrades to [] when fetchJson reports
// failure (null).
// =============================================================================
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFetchJson = mock.fn(async () => null) as any;

mock.module("./shared", {
  namedExports: {
    fetchJson: mockFetchJson,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mock.fn(), warn: mock.fn(), info: mock.fn() },
  },
});

let adzunaAdapter: typeof import("./adzuna").adzunaAdapter;
let usajobsAdapter: typeof import("./usajobs").usajobsAdapter;
let jsearchAdapter: typeof import("./jsearch").jsearchAdapter;

before(async () => {
  process.env.ADZUNA_APP_ID = "adzuna-id";
  process.env.ADZUNA_APP_KEY = "adzuna-key";
  process.env.USAJOBS_API_KEY = "usajobs-key";
  process.env.USAJOBS_EMAIL = "jobs@example.org";
  process.env.JSEARCH_API_KEY = "jsearch-key";
  ({ adzunaAdapter } = await import("./adzuna"));
  ({ usajobsAdapter } = await import("./usajobs"));
  ({ jsearchAdapter } = await import("./jsearch"));
});

beforeEach(() => {
  mockFetchJson.mock.resetCalls();
  mockFetchJson.mock.mockImplementation(async () => null);
});

describe("adzunaAdapter timeout wiring (VQ-R-019)", () => {
  it("routes the request through shared fetchJson", async () => {
    mockFetchJson.mock.mockImplementation(async () => ({
      results: [
        {
          id: "1",
          title: "Warehouse Associate",
          company: { display_name: "Acme" },
          location: { display_name: "Charleston, WV" },
          salary_min: 30000,
          salary_max: null,
          description: "Move boxes.",
          redirect_url: "https://example.com/jobs/1",
        },
      ],
    }));

    const jobs = await adzunaAdapter.fetchJobs("Charleston, WV", 25);

    assert.equal(mockFetchJson.mock.callCount(), 1);
    const url = String(mockFetchJson.mock.calls[0].arguments[0]);
    assert.ok(url.startsWith("https://api.adzuna.com/"));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].sourceId, "adzuna:1");
  });

  it("returns [] when fetchJson reports failure", async () => {
    const jobs = await adzunaAdapter.fetchJobs("Charleston, WV", 25);
    assert.deepEqual(jobs, []);
  });
});

describe("usajobsAdapter timeout wiring (VQ-R-019)", () => {
  it("routes the request through shared fetchJson with auth headers intact", async () => {
    mockFetchJson.mock.mockImplementation(async () => ({
      SearchResult: {
        SearchResultItems: [
          {
            MatchedObjectId: "fed-1",
            MatchedObjectDescriptor: {
              PositionTitle: "Mail Clerk",
              OrganizationName: "USPS",
              PositionLocationDisplay: "Charleston, WV",
              PositionRemuneration: [],
              QualificationSummary: "Sort mail.",
              PositionURI: "https://usajobs.gov/job/fed-1",
            },
          },
        ],
      },
    }));

    const jobs = await usajobsAdapter.fetchJobs("Charleston, WV", 25);

    assert.equal(mockFetchJson.mock.callCount(), 1);
    const [url, init] = mockFetchJson.mock.calls[0].arguments;
    assert.ok(String(url).startsWith("https://data.usajobs.gov/"));
    assert.equal((init.headers as Record<string, string>)["Authorization-Key"], "usajobs-key");
    assert.equal((init.headers as Record<string, string>)["User-Agent"], "jobs@example.org");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].sourceId, "usajobs:fed-1");
  });

  it("returns [] when fetchJson reports failure", async () => {
    const jobs = await usajobsAdapter.fetchJobs("Charleston, WV", 25);
    assert.deepEqual(jobs, []);
  });
});

describe("jsearchAdapter timeout wiring (VQ-R-019)", () => {
  it("routes the request through shared fetchJson with the RapidAPI headers", async () => {
    mockFetchJson.mock.mockImplementation(async () => ({
      data: [
        {
          job_id: "js-1",
          job_title: "Retail Associate",
          employer_name: "ShopCo",
          job_city: "Charleston",
          job_state: "WV",
          job_min_salary: null,
          job_max_salary: null,
          job_salary_currency: null,
          job_salary_period: null,
          job_description: "Help customers.",
          job_apply_link: "https://example.com/js-1",
        },
      ],
    }));

    const jobs = await jsearchAdapter.fetchJobs("Charleston, WV", 25);

    assert.equal(mockFetchJson.mock.callCount(), 1);
    const [url, init] = mockFetchJson.mock.calls[0].arguments;
    assert.ok(String(url).startsWith("https://jsearch.p.rapidapi.com/"));
    assert.equal((init.headers as Record<string, string>)["x-rapidapi-key"], "jsearch-key");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].sourceId, "jsearch:js-1");
  });

  it("returns [] when fetchJson reports failure", async () => {
    const jobs = await jsearchAdapter.fetchJobs("Charleston, WV", 25);
    assert.deepEqual(jobs, []);
  });
});
