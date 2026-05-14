import assert from "node:assert/strict";
import { test } from "node:test";

import { fileCategoryForPortfolioType, normalizePortfolioItemType } from "./portfolio";

test("normalizePortfolioItemType accepts canonical values", () => {
  assert.equal(normalizePortfolioItemType("certification"), "certification");
  assert.equal(normalizePortfolioItemType("achievement"), "achievement");
  assert.equal(normalizePortfolioItemType("project"), "project");
});

test("normalizePortfolioItemType preserves legacy UI aliases", () => {
  assert.equal(normalizePortfolioItemType("cert"), "certification");
  assert.equal(normalizePortfolioItemType("award"), "achievement");
  assert.equal(normalizePortfolioItemType("document"), "other");
});

test("fileCategoryForPortfolioType keeps certification uploads contextual", () => {
  assert.equal(fileCategoryForPortfolioType("certification"), "certification");
  assert.equal(fileCategoryForPortfolioType("resume"), "resume");
  assert.equal(fileCategoryForPortfolioType("project"), "portfolio");
});
