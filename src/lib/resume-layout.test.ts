import assert from "node:assert/strict";
import test from "node:test";
import {
  RESUME_FONTS,
  RESUME_FONT_KEYS,
  DEFAULT_RESUME_FONT,
  getResumeFont,
  RESUME_SECTION_ORDER,
  RESUME_SECTION_TITLES,
} from "@/lib/resume-layout";

test("RESUME_FONT_KEYS includes the four supported fonts", () => {
  assert.deepEqual([...RESUME_FONT_KEYS], ["times", "arial", "garamond", "lato"]);
});

test("default font is times and is a core font", () => {
  assert.equal(DEFAULT_RESUME_FONT, "times");
  assert.equal(RESUME_FONTS.times.kind, "core");
  assert.equal(RESUME_FONTS.times.jsPdfFont, "times");
});

test("getResumeFont falls back to default on unknown/empty key", () => {
  assert.equal(getResumeFont("nope").key, "times");
  assert.equal(getResumeFont(null).key, "times");
  assert.equal(getResumeFont("lato").key, "lato");
});

test("embedded fonts carry a googleFamily for the HTML side", () => {
  assert.equal(RESUME_FONTS.garamond.kind, "embedded");
  assert.ok(RESUME_FONTS.garamond.googleFamily);
  assert.ok(RESUME_FONTS.lato.googleFamily);
});

test("every section in the order has a title", () => {
  for (const id of RESUME_SECTION_ORDER) {
    assert.ok(RESUME_SECTION_TITLES[id], `missing title for ${id}`);
  }
});
