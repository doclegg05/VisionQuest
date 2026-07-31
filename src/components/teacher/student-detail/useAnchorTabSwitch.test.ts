import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveTabForAnchor,
  STUDENT_DETAIL_ANCHOR_TO_TAB,
} from "./useAnchorTabSwitch";

describe("resolveTabForAnchor", () => {
  const map = {
    "case-notes": "coach",
    "certification-review": "progress",
    "account-actions": "admin",
  } as const;

  it("returns the mapped tab for a known anchor", () => {
    assert.equal(resolveTabForAnchor("case-notes", map), "coach");
    assert.equal(resolveTabForAnchor("certification-review", map), "progress");
    assert.equal(resolveTabForAnchor("account-actions", map), "admin");
  });

  it("strips a leading hash from the input", () => {
    assert.equal(resolveTabForAnchor("#case-notes", map), "coach");
  });

  it("returns null for an unknown anchor", () => {
    assert.equal(resolveTabForAnchor("bogus", map), null);
  });

  it("returns null for an empty anchor", () => {
    assert.equal(resolveTabForAnchor("", map), null);
  });
});

describe("student detail career anchor ownership", () => {
  it("opens career discovery on Coach, where the section renders", () => {
    assert.equal(
      resolveTabForAnchor("#career-discovery", STUDENT_DETAIL_ANCHOR_TO_TAB),
      "coach",
    );
  });

  it("opens career progress on Progress, where the section renders", () => {
    assert.equal(
      resolveTabForAnchor("#career-progress", STUDENT_DETAIL_ANCHOR_TO_TAB),
      "progress",
    );
  });
});

describe("STUDENT_DETAIL_ANCHOR_TO_TAB integrity", () => {
  it("maps only anchors whose ids render in the student-detail tree", () => {
    // A key with no rendered id="…" is a dead anchor: the tab switches but
    // nothing scrolls into view. Check the sources on disk so future keys
    // cannot go dead silently.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const sourcePaths = [
      // Tab components in this directory (skip .ts so the map's own source
      // in useAnchorTabSwitch.ts cannot satisfy the check).
      ...readdirSync(testDir)
        .filter((fileName) => fileName.endsWith(".tsx"))
        .map((fileName) => join(testDir, fileName)),
      // The parent component that renders the admin sections.
      join(testDir, "..", "StudentDetail.tsx"),
    ];
    const renderedSource = sourcePaths
      .map((sourcePath) => readFileSync(sourcePath, "utf8"))
      .join("\n");

    for (const anchor of Object.keys(STUDENT_DETAIL_ANCHOR_TO_TAB)) {
      assert.ok(
        renderedSource.includes(`id="${anchor}"`),
        `Anchor "${anchor}" has no rendered id="${anchor}" in the student-detail sources`,
      );
    }
  });
});
