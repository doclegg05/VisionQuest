import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { localEmployersAdapter } from "./local-employers";
import { filterQualityJobs } from "../job-quality";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const posting = { id: "744000156289379", name: "Cashier", company: { name: "Pilot Company" }, location: { city: "Morgantown", region: "WV", country: "us", remote: false } };
const detail = {
  ...posting, active: true, releasedDate: "2026-10-19T11:04:55.497Z", typeOfEmployment: { label: "Full-time" },
  jobAd: { sections: { companyDescription: { text: "Pay Rates Starting between: $11.38 - $14.88 / hour" }, jobDescription: { text: "<p>Help guests and handle purchases at the cash register.</p>" }, qualifications: { text: "Follow food and workplace safety procedures." } } },
};
describe("free local employer feeds", () => {
  it("imports full employer descriptions and stated pay without credentials", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input); urls.push(url);
      if (url.includes("/Dominos/")) return Response.json({ totalFound: 0, content: [] });
      return Response.json(url.includes("?") ? { totalFound: 1, content: [posting] } : detail);
    };
    const jobs = await localEmployersAdapter.fetchJobs("Morgantown, WV", 25);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].salaryMin, 11.38);
    assert.equal(jobs[0].employmentType, "full_time");
    assert.match(jobs[0].description, /workplace safety/);
    assert.equal(jobs[0].sourceId, "localemployers:PilotCompany:744000156289379");
    assert.equal(filterQualityJobs(jobs).jobs.length, 1);
    for (const url of urls.filter((url) => url.includes("?"))) {
      const params = new URL(url).searchParams;
      assert.equal(params.get("city"), "Morgantown");
      assert.equal(params.get("region"), "WV");
      assert.equal(params.get("country"), "us");
    }
  });
  it("excludes inactive, out-of-city and wrong-state listings", async () => {
    for (const patch of [{ active: false }, { location: { ...posting.location, city: "Dallas" } }, { location: { ...posting.location, region: "PA" } }]) {
      globalThis.fetch = async (input) => Response.json(String(input).includes("/Dominos/") ? { content: [] }
        : String(input).includes("?") ? { content: [posting] } : { ...detail, ...patch });
      assert.deepEqual(await localEmployersAdapter.fetchJobs("Morgantown, WV", 25), []);
    }
  });
  it("keeps an unknown wage unknown instead of using a benefit as salary", async () => {
    globalThis.fetch = async (input) => Response.json(String(input).includes("/Dominos/") ? { content: [] }
      : String(input).includes("?") ? { content: [posting] } : { ...detail, jobAd: { sections: { jobDescription: { text: "Help guests with purchases. Benefits include a $10 health plan." } } } });
    assert.equal((await localEmployersAdapter.fetchJobs("Morgantown, WV", 25))[0].salaryMin, null);
  });
  it("retains one employer's jobs when another source fails, but exposes a total outage", async () => {
    globalThis.fetch = async (input) => String(input).includes("/Dominos/") ? new Response("outage", { status: 503 })
      : Response.json(String(input).includes("?") ? { content: [posting] } : detail);
    assert.equal((await localEmployersAdapter.fetchJobs("Morgantown, WV", 25)).length, 1);
    globalThis.fetch = async () => new Response("outage", { status: 503 });
    await assert.rejects(() => localEmployersAdapter.fetchJobs("Morgantown, WV", 25), /could not be read/);
  });
});
