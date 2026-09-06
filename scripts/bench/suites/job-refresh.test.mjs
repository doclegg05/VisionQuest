import { test } from "node:test";
import assert from "node:assert/strict";
import { adapterNameForUrl, withDeadline } from "./job-refresh.mjs";

test("adapterNameForUrl: matches each of the five adapters' real hosts", () => {
  assert.equal(adapterNameForUrl("https://api.careeronestop.org/v1/jobsearch/x/y"), "careeronestop");
  assert.equal(adapterNameForUrl("https://api.talroo.com/v1/search?q=cna"), "talroo");
  assert.equal(adapterNameForUrl("https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=x"), "adzuna");
  assert.equal(adapterNameForUrl("https://jsearch.p.rapidapi.com/search?query=jobs"), "jsearch");
  assert.equal(adapterNameForUrl("https://data.usajobs.gov/api/search?LocationName=x"), "usajobs");
});

test("adapterNameForUrl: an unrecognized host returns null rather than guessing", () => {
  assert.equal(adapterNameForUrl("https://example.invalid/anything"), null);
});

test("withDeadline: resolves with the promise's value when it settles first", async () => {
  const value = await withDeadline(Promise.resolve("ok"), 1000, "should not fire");
  assert.equal(value, "ok");
});

test("withDeadline: rejects with the deadline's message when the promise never settles in time", async () => {
  const neverSettles = new Promise(() => {});
  await assert.rejects(
    () => withDeadline(neverSettles, 20, "deadline fired"),
    /deadline fired/,
  );
});

test("withDeadline: propagates the promise's own rejection when it rejects before the deadline", async () => {
  await assert.rejects(
    () => withDeadline(Promise.reject(new Error("boom")), 1000, "should not fire"),
    /boom/,
  );
});
