import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  annualSalaryText,
  mapEachJob,
  queryTokens,
  stripHtml,
  textMatchesQuery,
  xmlTag,
} from "./shared";
import { logger } from "@/lib/logger";
import type { NormalizedJob } from "../types";

describe("job-board adapter shared helpers", () => {
  it("keeps meaningful query tokens and removes common stopwords", () => {
    assert.deepEqual(queryTokens("AI support specialist for students"), [
      "ai",
      "support",
      "specialist",
      "students",
    ]);
  });

  it("matches phrases or enough query tokens against source text", () => {
    assert.equal(textMatchesQuery("customer support", "Remote customer support associate"), true);
    assert.equal(textMatchesQuery("frontend support", "React frontend engineer"), true);
    assert.equal(textMatchesQuery("frontend support billing", "React frontend engineer"), false);
  });

  it("strips html and decodes common entities", () => {
    assert.equal(stripHtml("<p>Student &amp; family&nbsp;support</p>"), "Student & family support");
  });

  it("formats annual salary ranges for the salary parser", () => {
    assert.equal(annualSalaryText(52_000, 62_000), "$52000-$62000/year");
    assert.equal(annualSalaryText(null, 41_600), "$41600/year");
    assert.equal(annualSalaryText(null, null), null);
  });

  it("extracts rss xml tag content", () => {
    const item = "<item><title>VisionQuest &amp; Job Scout</title><guid>abc-123</guid></item>";

    assert.equal(xmlTag(item, "title"), "VisionQuest & Job Scout");
    assert.equal(xmlTag(item, "link"), "");
  });
});

describe("mapEachJob", () => {
  const normalized = (id: string): NormalizedJob => ({
    title: "t",
    company: "c",
    location: "l",
    salary: null,
    salaryMin: null,
    description: "",
    url: "https://x",
    source: "test-source",
    sourceType: "api",
    sourceId: id,
  });

  it("maps every well-formed item", () => {
    const jobs = mapEachJob([1, 2, 3], "test-source", (n) => normalized(`id-${n}`));
    assert.deepEqual(
      jobs.map((j) => j.sourceId),
      ["id-1", "id-2", "id-3"],
    );
  });

  it("drops an item whose mapper returns null, without logging", (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    const jobs = mapEachJob([1, 2], "test-source", (n) => (n === 1 ? null : normalized("ok")));
    assert.equal(jobs.length, 1);
    assert.equal(warnMock.mock.calls.length, 0);
  });

  it("isolates ONE malformed item's thrown error: the rest of the batch still returns, exactly one warning logged", (t: TestContext) => {
    const warnMock = t.mock.method(logger, "warn", () => {});
    const items = ["bad", "good"];
    const jobs = mapEachJob(items, "test-source", (item, index) => {
      if (item === "bad") throw new Error("corrupt row — secret-looking-value");
      return normalized(`id-${index}`);
    });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].sourceId, "id-1");
    assert.equal(warnMock.mock.calls.length, 1);
    const [message, context] = warnMock.mock.calls[0].arguments;
    assert.equal(message, "Job source item failed to normalize");
    assert.deepEqual(context, { source: "test-source", index: 0 });
    // The log must never carry the item payload or the thrown error's text.
    const serialized = JSON.stringify(warnMock.mock.calls[0].arguments);
    assert.ok(!serialized.includes("secret-looking-value"));
    assert.ok(!serialized.includes("bad"));
  });
});
