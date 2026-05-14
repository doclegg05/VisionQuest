import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  annualSalaryText,
  queryTokens,
  stripHtml,
  textMatchesQuery,
  xmlTag,
} from "./shared";

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
