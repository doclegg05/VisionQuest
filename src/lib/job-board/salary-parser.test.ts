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
});
