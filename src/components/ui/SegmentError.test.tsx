import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToString } from "react-dom/server";

import { SegmentError } from "./SegmentError";

describe("SegmentError", () => {
  it("always offers a way to the Help page, alongside the segment's own back link", () => {
    const html = renderToString(
      <SegmentError
        error={new Error("boom")}
        reset={() => {}}
        title="We couldn't load this"
        message="Try again in a moment."
      />,
    );
    assert.ok(html.includes('href="/help"'), "expected an /help link");
  });

  it("still renders the segment-specific back link", () => {
    const html = renderToString(
      <SegmentError
        error={new Error("boom")}
        reset={() => {}}
        title="We couldn't load this"
        message="Try again in a moment."
        backHref="/career"
        backLabel="Back to Career"
      />,
    );
    assert.ok(html.includes('href="/career"'));
    assert.ok(html.includes("Back to Career"));
  });
});

function findErrorFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findErrorFiles(full, out);
    } else if (entry.name === "error.tsx") {
      out.push(full);
    }
  }
  return out;
}

// Sage is VisionQuest's designed help channel, so a Sage outage must not be
// the only exit from every other broken page too. Every route-segment error
// boundary under (student) must give a way out to /help — either by using
// the shared SegmentError component above (which now always renders the
// link), or by linking /help directly if it doesn't use SegmentError.
describe("every student route segment's error.tsx has a path to /help", () => {
  const studentAppRoot = join(process.cwd(), "src", "app", "(student)");
  const errorFiles = findErrorFiles(studentAppRoot);

  it("finds the known segment error boundaries (sanity check on the file walk)", () => {
    assert.ok(
      errorFiles.length >= 18,
      `expected at least 18 error.tsx files under src/app/(student), found ${errorFiles.length}`,
    );
  });

  for (const file of errorFiles) {
    const relPath = relative(process.cwd(), file);
    it(`${relPath} links to /help (directly, or via SegmentError)`, () => {
      const source = readFileSync(file, "utf8");
      const usesSegmentError = source.includes("SegmentError");
      const linksHelpDirectly = /href=["']\/help["']/.test(source);
      assert.ok(
        usesSegmentError || linksHelpDirectly,
        `${relPath} has no path to /help — it neither uses SegmentError nor links /help directly`,
      );
    });
  }
});
