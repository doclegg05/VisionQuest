import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";
import { LEAD_PAY_PERIODS } from "@/lib/connect/leads-shared";
import { LEAD_SHIFTS } from "@/lib/connect/work-profile-shared";

import { AddLeadForm } from "./AddLeadForm";

/**
 * The "Add lead" form (Task 3.4).
 *
 * The first test is the one that would have saved Phase 2 a CI break: a
 * "use client" component must not reach a module that imports the Prisma
 * client, or `next build` puts node:async_hooks in the browser bundle. It is
 * asserted on the SOURCE, because a bundling failure does not show up in
 * renderToString.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/teacher/connect/AddLeadForm.tsx"),
  "utf8",
);

function render() {
  return renderToString(
    <AddLeadForm
      employers={[{ id: "emp-1", name: "Mountain Metal" }]}
      classes={[{ id: "class-1", name: "SPOKES Fall 2026" }]}
    />,
  );
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&[a-z#0-9]+;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

describe("AddLeadForm — client bundle safety", () => {
  it("imports only the Prisma-free shared modules", () => {
    assert.ok(SOURCE.includes('"use client"'), "this is a client component");
    for (const forbidden of [
      '"@/lib/db"',
      '"@/lib/connect/leads"',
      '"@/lib/connect/employers"',
      '"@/lib/connect/matching"',
      '"@/lib/connect/work-profile"',
    ]) {
      assert.ok(
        !SOURCE.includes(`from ${forbidden}`),
        `${forbidden} pulls the Prisma client into the browser bundle and fails next build`,
      );
    }
    assert.ok(SOURCE.includes('from "@/lib/connect/leads-shared"'));
    assert.ok(SOURCE.includes('from "@/lib/connect/work-profile-shared"'));
  });
});

describe("AddLeadForm — the three ways in", () => {
  it("offers typed, job order, and from a class board", () => {
    const text = stripTags(render());
    assert.ok(text.includes("Type it in"), text);
    assert.ok(text.includes("From a MACC job order"), text);
    assert.ok(text.includes("From a job on a class board"), text);
  });

  it("lists every shift the matcher understands", () => {
    const text = stripTags(render());
    for (const shift of LEAD_SHIFTS) {
      assert.ok(
        text.toLowerCase().includes(shift),
        `the form must offer the "${shift}" shift the matcher scores on`,
      );
    }
  });

  it("lists every pay period the lead schema accepts", () => {
    const html = render();
    for (const period of LEAD_PAY_PERIODS) {
      assert.ok(html.includes(`value="${period}"`), `missing pay period ${period}`);
    }
  });

  it("defaults the class picker to all classes", () => {
    const html = render();
    assert.ok(html.includes("All classes"), html);
  });
});

describe("AddLeadForm — mobile and copy", () => {
  it("gives every control a 44px touch target", () => {
    const html = render();
    const controls = html.match(/<(input|select|textarea|button)\b/gu) ?? [];
    assert.ok(controls.length > 5, "sanity: the form has controls");
    // Every text control and the submit button carry the shared min-height;
    // the radio and checkbox inputs sit inside 44px-tall labels instead.
    const minHeights = html.match(/min-h-\[44px\]/gu) ?? [];
    assert.ok(
      minHeights.length >= 8,
      `expected 44px targets throughout, found ${minHeights.length}`,
    );
  });

  it("explains what leaving the shift blank means, in plain words", () => {
    const text = stripTags(render());
    assert.ok(text.includes("No shift means no student is left out for their hours."), text);
  });

  it("explains why a bus route matters", () => {
    const text = stripTags(render());
    assert.ok(text.includes("It keeps students with no car in the list."), text);
  });

  it("reads at grade 6", () => {
    const text = stripTags(render());
    const readability = assessReadability(text, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(readability.withinTarget, `form copy reads at grade ${readability.grade}: ${text}`);
  });
});
