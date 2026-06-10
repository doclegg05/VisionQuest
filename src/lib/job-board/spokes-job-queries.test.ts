import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSpokesJobQueryTitles } from "./spokes-job-queries";

describe("spokes job query titles", () => {
  it("includes the healthcare/trades supplement", () => {
    const titles = getSpokesJobQueryTitles();
    assert.ok(titles.includes("Certified Nursing Assistant"));
    assert.ok(titles.includes("CDL Driver"));
  });

  it("includes core SPOKES cluster titles", () => {
    const titles = getSpokesJobQueryTitles().map((t) => t.toLowerCase());
    assert.ok(titles.includes("administrative assistant"));
  });

  it("omits vague, non-searchable titles", () => {
    const titles = getSpokesJobQueryTitles().map((t) => t.toLowerCase());
    assert.ok(!titles.some((t) => t.includes("entry-level positions")));
  });

  it("dedupes case-insensitively and caps the list", () => {
    const titles = getSpokesJobQueryTitles();
    const lower = titles.map((t) => t.toLowerCase());
    assert.equal(new Set(lower).size, titles.length);
    assert.ok(titles.length <= 16);
  });
});
