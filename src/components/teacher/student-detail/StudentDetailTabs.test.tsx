import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import StudentDetailTabs from "./StudentDetailTabs";

/**
 * D4 (2026-09-07): StudentDetailTabs had touch targets but none of the ARIA
 * tablist semantics the student-side PortfolioPage already carries — no
 * `role="tablist"`/`role="tab"`/`aria-selected`/`aria-controls`/
 * `role="tabpanel"`, and no roving tabIndex or arrow-key navigation. This
 * repo has no jsdom, so keyboard BEHAVIOUR (which renderToString cannot
 * exercise — there is no DOM to dispatch a KeyboardEvent against) is proven
 * by a source-text assertion on the same file whose markup the render
 * assertions check, matching the ProgressTab.application-verify.test.tsx
 * convention.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/teacher/student-detail/StudentDetailTabs.tsx"),
  "utf8",
);

function renderTabs() {
  return renderToString(
    <StudentDetailTabs studentId="student-1" studentName="Sam Rivera">
      {{
        coach: <p>Coach panel content</p>,
        progress: <p>Progress panel content</p>,
        admin: <p>Admin panel content</p>,
      }}
    </StudentDetailTabs>,
  );
}

describe("StudentDetailTabs ARIA tablist pattern", () => {
  it("renders a tablist wrapping exactly three tabs", () => {
    const html = renderTabs();

    assert.match(html, /role="tablist"/);
    const tabMatches = html.match(/role="tab"/g) ?? [];
    assert.equal(tabMatches.length, 3, "expected exactly three role=\"tab\" elements");
  });

  it("marks only the default (coach) tab selected, with roving tabIndex", () => {
    const html = renderTabs();

    // The Coach tab is selected and focusable (tabIndex 0); Progress and
    // Admin are unselected and removed from the tab order (tabIndex -1) —
    // this is what makes arrow-key roving meaningful instead of decorative.
    assert.match(html, /aria-selected="true"[^>]*>[\s\S]*?Coach|Coach[\s\S]*?aria-selected="true"/);
    const selectedTrueCount = (html.match(/aria-selected="true"/g) ?? []).length;
    const selectedFalseCount = (html.match(/aria-selected="false"/g) ?? []).length;
    assert.equal(selectedTrueCount, 1, "exactly one tab should be aria-selected=true");
    assert.equal(selectedFalseCount, 2, "the other two tabs should be aria-selected=false");

    const tabIndexZero = (html.match(/tabIndex/g) ?? []).length; // React strips tabIndex from SSR HTML attr name to tabindex
    void tabIndexZero;
    const tabindexZeroCount = (html.match(/tabindex="0"/g) ?? []).length;
    const tabindexNegOneCount = (html.match(/tabindex="-1"/g) ?? []).length;
    assert.equal(tabindexZeroCount, 1, "exactly one tab should be in the tab order (tabindex=0)");
    assert.equal(tabindexNegOneCount, 2, "the other two tabs should be out of the tab order (tabindex=-1)");
  });

  it("wires aria-controls to a single tabpanel that carries role=tabpanel and aria-labelledby", () => {
    const html = renderTabs();

    const controlsMatch = html.match(/aria-controls="([^"]+)"/);
    assert.ok(controlsMatch, "expected at least one aria-controls attribute");
    const panelId = controlsMatch![1];

    assert.match(html, new RegExp(`id="${panelId}"[^>]*role="tabpanel"`));
    assert.match(html, /aria-labelledby="[^"]+"/);
  });

  it("renders only the active tab's panel content", () => {
    const html = renderTabs();

    assert.ok(html.includes("Coach panel content"), "the default active tab's content should render");
    assert.ok(!html.includes("Progress panel content"), "inactive tab content should not render");
    assert.ok(!html.includes("Admin panel content"), "inactive tab content should not render");
  });

  it("still gives every tab button an accessible id derived from its key (useAnchorTabSwitch focus target)", () => {
    const html = renderTabs();

    for (const key of ["coach", "progress", "admin"]) {
      assert.match(
        html,
        new RegExp(`id="[^"]*${key}[^"]*"[^>]*role="tab"`),
        `expected a role="tab" element with an id naming "${key}"`,
      );
    }
  });

  it("handles ArrowRight/ArrowLeft/Home/End on each tab button (source-text: no DOM to dispatch a real KeyboardEvent)", () => {
    assert.match(SOURCE, /onKeyDown/);
    assert.match(SOURCE, /"ArrowRight"/);
    assert.match(SOURCE, /"ArrowLeft"/);
    assert.match(SOURCE, /"Home"/);
    assert.match(SOURCE, /"End"/);
    // Roving tabIndex driven by the actual selected state, not a static prop.
    assert.match(SOURCE, /tabIndex=\{[^}]*\?\s*0\s*:\s*-1\}/);
  });
});
