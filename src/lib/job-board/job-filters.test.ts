import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJobFilters, buildJobFilterWhere } from "./job-filters";

describe("job filters", () => {
  it("parses and validates query params", () => {
    const params = new URLSearchParams({ q: "  nurse  ", postedWithinDays: "14", minPay: "15", jobType: "part_time" });
    assert.deepEqual(parseJobFilters(params), { q: "nurse", postedWithinDays: 14, minPay: 15, jobType: "part_time" });
  });

  it("rejects invalid values", () => {
    const params = new URLSearchParams({ postedWithinDays: "99", minPay: "-5", jobType: "contract" });
    assert.deepEqual(parseJobFilters(params), { q: "", postedWithinDays: null, minPay: null, jobType: null });
  });

  it("includes unknown-pay jobs when minPay is set", () => {
    const where = buildJobFilterWhere({ q: "", postedWithinDays: null, minPay: 15, jobType: null }, new Date("2026-06-09T00:00:00Z"));
    assert.deepEqual(where.AND, [{ OR: [{ salaryMin: { gte: 15 } }, { salaryMin: null }] }]);
  });

  it("filters by createdAt window and exact employmentType", () => {
    const now = new Date("2026-06-09T00:00:00Z");
    const where = buildJobFilterWhere({ q: "", postedWithinDays: 7, minPay: null, jobType: "full_time" }, now);
    assert.equal(where.employmentType, "full_time");
    assert.deepEqual(where.createdAt, { gte: new Date(now.getTime() - 7 * 86_400_000) });
  });

  it("returns an empty object when no filters are active", () => {
    assert.deepEqual(buildJobFilterWhere({ q: "", postedWithinDays: null, minPay: null, jobType: null }, new Date()), {});
  });
});
