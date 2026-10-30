import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { wvuMedicineAdapter } from "./wvu-medicine";
import { filterQualityJobs } from "../job-quality";
import { classifyJobProximity } from "../recommendation";
import { fetchSourceJobs } from "./shared";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// Shape captured from the public employer website on 2026-10-30. Field
// names intentionally match the real search and detail responses.
const summary = {
  title: "Housekeeping Aide",
  externalPath: "/job/Summersville-Regional-Medical-Center-SRMC/Housekeeping-Aide_JR26-48481",
  locationsText: "Summersville Regional Medical Center (SRMC)",
  postedOn: "Posted Today",
  bulletFields: ["JR26-48481"],
};
const info = {
  title: "Housekeeping Aide",
  jobReqId: "JR26-48481",
  location: "Summersville Regional Medical Center (SRMC)",
  jobDescription: "<p>Clean patient rooms and common areas. Follow cleaning and safety procedures.</p>",
  timeType: "Part time",
  startDate: "2026-10-29",
  canApply: true,
  posted: true,
};

describe("WVU Medicine employer-direct adapter", () => {
  it("imports a real-shaped response without credentials and produces a saveable class-board input", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json(String(input).endsWith("/jobs")
        ? { total: 1, jobPostings: [summary] }
        : { jobPostingInfo: info, userAuthenticated: false });
    };
    assert.equal(wvuMedicineAdapter.isConfigured(), true);
    const jobs = await wvuMedicineAdapter.fetchJobs("Summersville, WV", 25);
    assert.equal(jobs.length, 1);
    const [job] = jobs;
    assert.equal(job.sourceId, "wvumedicine:JR26-48481");
    assert.equal(job.company, "WVU Medicine");
    assert.equal(job.employmentType, "part_time");
    assert.equal(job.salary, null, "never manufacture a wage");
    assert.equal(job.salaryMin, null);
    assert.equal(job.postedAt, "2026-10-29T00:00:00.000Z");
    assert.ok(job.url.startsWith("https://wvumedicine.wd1.myworkdayjobs.com/en-US/WVUH/job/"));
    assert.equal(filterQualityJobs(jobs).jobs.length, 1);
    assert.equal(classifyJobProximity(job, "Summersville, WV"), "local");
    assert.equal(requests[0].init?.method, "POST");
    assert.equal(JSON.parse(String(requests[0].init?.body)).searchText, "Summersville");
    for (const request of requests) {
      assert.equal(new Headers(request.init?.headers).has("Authorization"), false);
      assert.equal(new Headers(request.init?.headers).get("Accept-Language"), "en-US", "Workday rejects Node's wildcard locale");
    }
  });

  it("does not treat a description keyword match or multi-location primary location as local", async () => {
    globalThis.fetch = async (input) => Response.json(String(input).endsWith("/jobs")
      ? { total: 1, jobPostings: [{ ...summary, locationsText: "5 Locations" }] }
      : { jobPostingInfo: { ...info, location: "Morgantown, WV" } });
    assert.deepEqual(await wvuMedicineAdapter.fetchJobs("Summersville, WV", 50), []);
  });

  it("excludes closed or no-longer-posted positions", async () => {
    for (const flags of [{ canApply: false }, { posted: false }]) {
      globalThis.fetch = async (input) => Response.json(String(input).endsWith("/jobs")
        ? { total: 1, jobPostings: [summary] }
        : { jobPostingInfo: { ...info, ...flags } });
      assert.deepEqual(await wvuMedicineAdapter.fetchJobs("Summersville, WV", 25), []);
    }
  });

  it("paginates, deduplicates by employer path and never follows arbitrary detail URLs", async () => {
    let pages = 0;
    let details = 0;
    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/jobs")) {
        pages++;
        return Response.json({ total: 21, jobPostings: pages === 1
          ? Array.from({ length: 20 }, () => summary)
          : [{ externalPath: "https://example.com/other" }, { externalPath: "/job/../../other" }, summary] });
      }
      details++;
      assert.ok(String(input).startsWith("https://wvumedicine.wd1.myworkdayjobs.com/wday/cxs/wvumedicine/WVUH/job/"));
      return Response.json({ jobPostingInfo: info });
    };
    assert.equal((await wvuMedicineAdapter.fetchJobs("Summersville, WV", 25)).length, 1);
    assert.equal(pages, 2);
    assert.equal(details, 1);
  });

  it("reports an upstream outage or response drift instead of an empty successful source", async () => {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(() => wvuMedicineAdapter.fetchJobs("Summersville, WV", 25), /could not be reached/);
    globalThis.fetch = async () => Response.json({ changed: true });
    await assert.rejects(() => wvuMedicineAdapter.fetchJobs("Summersville, WV", 25), /unexpected response/);
    globalThis.fetch = async (input) => Response.json(String(input).endsWith("/jobs")
      ? { total: 1, jobPostings: [summary] } : { changed: true });
    await assert.rejects(() => wvuMedicineAdapter.fetchJobs("Summersville, WV", 25), /details could not be read/);
  });

  it("preserves a readable detail when another job's detail fails", async () => {
    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/jobs")) return Response.json({ total: 2, jobPostings: [summary, { ...summary, externalPath: "/job/other" }] });
      if (String(input).endsWith("/other")) return new Response("unavailable", { status: 503 });
      return Response.json({ jobPostingInfo: info });
    };
    const warnings: string[] = [];
    assert.equal((await fetchSourceJobs(() => wvuMedicineAdapter.fetchJobs("Summersville, WV", 25), (warning) => warnings.push(warning))).length, 1);
    assert.match(warnings[0], /Partial results: 1 WVU Medicine job details could not be read/);
  });

  it("rejects unsupported search areas before requesting the employer site", async () => {
    globalThis.fetch = async () => { throw new Error("must not fetch"); };
    for (const region of ["", "26651", "Charleston, SC", "Summersville, WV, US"]) {
      await assert.rejects(() => wvuMedicineAdapter.fetchJobs(region, 25), /need a city in West Virginia/);
    }
  });
});
