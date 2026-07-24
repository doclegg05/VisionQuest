import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSalaryToHourly } from "./salary-parser";

describe("parseSalaryToHourly", () => {
  it("parses hourly rate with /hr", () => {
    assert.equal(parseSalaryToHourly("$14.50/hr"), 14.50);
  });

  it("parses hourly rate with /hour", () => {
    assert.equal(parseSalaryToHourly("$16/hour"), 16);
  });

  it("parses yearly salary to hourly", () => {
    const result = parseSalaryToHourly("$30,000/year");
    assert.equal(result, 14.42); // 30000 / 2080 = 14.42
  });

  it("parses yearly with /yr", () => {
    const result = parseSalaryToHourly("$52,000/yr");
    assert.equal(result, 25); // 52000 / 2080 = 25
  });

  it("parses annual salary", () => {
    const result = parseSalaryToHourly("$41,600 annual");
    assert.equal(result, 20); // 41600 / 2080 = 20
  });

  it("takes minimum from range", () => {
    assert.equal(parseSalaryToHourly("$15-$18/hr"), 15);
  });

  it("infers yearly for large amounts without marker", () => {
    const result = parseSalaryToHourly("$50000");
    assert.equal(result, 24.04); // 50000 / 2080 = 24.038... rounded
  });

  it("returns null for non-numeric strings", () => {
    assert.equal(parseSalaryToHourly("Competitive"), null);
  });

  it("returns null for null input", () => {
    assert.equal(parseSalaryToHourly(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(parseSalaryToHourly(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseSalaryToHourly(""), null);
  });

  it("handles amount without dollar sign", () => {
    assert.equal(parseSalaryToHourly("14.50/hr"), 14.50);
  });

  it("strips commas from salary", () => {
    const result = parseSalaryToHourly("$120,000/year");
    assert.equal(result, 57.69); // 120000 / 2080 = 57.692... rounded
  });

  // Non-annual pay periods. Before these were handled, "$400 - $800 a week"
  // parsed as $400/hour and "$4,000/month" as $1.92/hour (via the >1000
  // yearly heuristic). jsearch emits "/week" and "/month" directly from
  // JSearch's job_salary_period, so this was reachable in production.
  describe("pay periods other than yearly", () => {
    it("converts weekly pay", () => {
      assert.equal(parseSalaryToHourly("$400 - $800 a week"), 10);
      assert.equal(parseSalaryToHourly("$1,500 - $1,800 a week"), 37.5);
      assert.equal(parseSalaryToHourly("$600/week"), 15);
      assert.equal(parseSalaryToHourly("$600 per wk"), 15);
    });

    it("converts daily pay", () => {
      assert.equal(parseSalaryToHourly("From $215 a day"), 26.88);
      assert.equal(parseSalaryToHourly("$160/day"), 20);
    });

    it("converts monthly pay", () => {
      assert.equal(parseSalaryToHourly("$2,450 a month"), 14.13);
      assert.equal(parseSalaryToHourly("$4,000/month"), 23.08);
      assert.equal(parseSalaryToHourly("$3,000 per mo"), 17.31);
    });

    it("converts biweekly pay without reading it as weekly", () => {
      assert.equal(parseSalaryToHourly("$2,000 biweekly"), 25);
      assert.equal(parseSalaryToHourly("$2,000 bi-weekly"), 25);
    });

    it("recognizes spelled-out hourly forms", () => {
      assert.equal(parseSalaryToHourly("$16.50 - $18.00 an hour"), 16.5);
      assert.equal(parseSalaryToHourly("From $20 an hour"), 20);
      assert.equal(parseSalaryToHourly("$22 per hour"), 22);
      assert.equal(parseSalaryToHourly("$19 hourly"), 19);
    });

    it("recognizes spelled-out yearly forms", () => {
      assert.equal(parseSalaryToHourly("$85,000 a year"), 40.87);
      assert.equal(parseSalaryToHourly("$62,400 annually"), 30);
    });
  });

  describe("guards against nonsense values", () => {
    // Indeed tags BAYADA's per-visit pay as "hourly"; other sources invent
    // their own units. An unrecognized unit is an unknown, not an hourly rate.
    it("returns null for an unrecognized explicit unit", () => {
      assert.equal(parseSalaryToHourly("$23 - $27 per point"), null);
      assert.equal(parseSalaryToHourly("$50/visit"), null);
    });

    it("returns null when the converted rate is implausible", () => {
      assert.equal(parseSalaryToHourly("$0.50/hr"), null);
      assert.equal(parseSalaryToHourly("$5,000/hour"), null);
    });

    it("still infers yearly for bare large amounts (remotive/ats free text)", () => {
      assert.equal(parseSalaryToHourly("$50000"), 24.04);
      assert.equal(parseSalaryToHourly("$45000-$55000"), 21.63);
    });

    it("still treats bare small amounts as hourly", () => {
      assert.equal(parseSalaryToHourly("$18-$22"), 18);
    });

    it("returns null for text with no usable amount", () => {
      assert.equal(parseSalaryToHourly("Competitive salary"), null);
      assert.equal(parseSalaryToHourly("DOE"), null);
    });
  });
});
