import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import InterventionQueue from "./InterventionQueue";

// M10: the collapsed row's quick actions ("Ask Sage", "View student") used to
// live INSIDE the accordion's toggle <button>, so every tap on one also fired
// onToggle and collapsed the row. That was patched with an
// onClick={(e) => e.stopPropagation()} guard on the actions container.
//
// The guard is gone now, and it should be: the header is a plain <div>, with
// the toggle button and the actions as siblings. Nothing bubbles, because
// nothing is nested. That also retires an invalid-HTML problem the guard only
// masked — interactive elements are not allowed inside a <button>, and a
// screen reader reading the row announced the actions as part of the toggle's
// label.
//
// This test pins the structure rather than the guard, so a refactor that
// re-nests the actions fails here instead of shipping a row that collapses
// out from under the teacher's thumb.

const alert = {
  id: "alert-1",
  type: "overdue_task",
  severity: "high",
  title: "Overdue task",
  summary: "Resume draft is 6 days late",
  sourceType: null,
  sourceId: null,
  detectedAt: "2026-09-01T12:00:00.000Z",
  student: { id: "stu-1", studentId: "S-1", displayName: "Casey Rivers" },
};

const html = renderToString(
  <InterventionQueue alerts={[alert]} inactivityQueue={[]} reviewQueue={[]} onAction={() => {}} />,
);

/**
 * The substring of `html` spanned by the first <button> carrying
 * `aria-expanded` — that is the accordion toggle — from its opening tag to its
 * matching close, counting nesting so a stray inner button cannot end it early.
 */
function accordionToggleInnerHtml(source: string): string {
  const openTag = /<button\b[^>]*aria-expanded[^>]*>/.exec(source);
  assert.ok(openTag, "expected an accordion toggle button carrying aria-expanded");

  const start = openTag.index + openTag[0].length;
  const tags = /<button\b|<\/button>/g;
  tags.lastIndex = start;

  let depth = 1;
  for (let tag = tags.exec(source); tag; tag = tags.exec(source)) {
    depth += tag[0] === "</button>" ? -1 : 1;
    if (depth === 0) return source.slice(start, tag.index);
  }
  throw new Error("accordion toggle button was never closed");
}

describe("InterventionQueue collapsed row (M10)", () => {
  it("renders the row's toggle and both quick actions", () => {
    assert.match(html, /aria-expanded/);
    assert.match(html, /Ask Sage/);
    assert.match(html, /View student/);
  });

  it("keeps the quick actions outside the toggle button, so tapping one cannot collapse the row", () => {
    const inner = accordionToggleInnerHtml(html);

    assert.doesNotMatch(inner, /Ask Sage/, "Ask Sage is nested inside the accordion toggle button");
    assert.doesNotMatch(inner, /View student/, "View student is nested inside the accordion toggle button");
    // The student's name IS part of the toggle's label, which is what proves
    // the helper found the real toggle and not some other button.
    assert.match(inner, /Casey Rivers/);
  });

  it("nests no interactive element inside the toggle button", () => {
    const inner = accordionToggleInnerHtml(html);

    assert.doesNotMatch(inner, /<button\b/);
    assert.doesNotMatch(inner, /<a\b/);
  });
});
