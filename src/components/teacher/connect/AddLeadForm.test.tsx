import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

// useRouter throws outside a mounted App Router; the form only calls
// router.refresh() after a successful save, which renderToString never reaches.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";
import { LEAD_PAY_PERIODS } from "@/lib/connect/leads-shared";
import { LEAD_SHIFTS } from "@/lib/connect/work-profile-shared";

// Imported dynamically in before(), AFTER mock.module has registered — a
// static import is hoisted and would bind the real next/navigation.
let AddLeadForm: typeof import("./AddLeadForm").AddLeadForm;

before(async () => {
  ({ AddLeadForm } = await import("./AddLeadForm"));
});

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
      certifications={[
        { id: "ic3", label: "IC3" },
        { id: "ready-to-work", label: "Ready to Work" },
      ]}
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

  it("names the job bank, not just the acronym", () => {
    // The apostrophe is HTML-escaped in the render, so the assertion is on the
    // two halves rather than the exact punctuation.
    const text = stripTags(render());
    assert.ok(text.includes("MACC job order"), text);
    assert.ok(
      text.includes("WorkForce WV") && text.includes("job bank"),
      '"MACC" alone is an acronym an instructor may not know',
    );
  });

  it("lets an instructor require a certification the matcher will enforce", () => {
    // Without this the requirements JSON could only ever be empty, so
    // mustHaveCerts — the sharpest hard block in fit() — was unreachable.
    const text = stripTags(render());
    assert.ok(text.includes("Cards they must already have"), text);
    assert.ok(text.includes("Ready to Work"), text);
  });

  it("warns that a required card leaves students off the lead", () => {
    const text = stripTags(render());
    assert.ok(
      text.includes("A student without it is left off this lead."),
      "a hard block needs to say it is a hard block",
    );
  });
});

describe("AddLeadForm — from a job on a class board", () => {
  it("offers a picker, not a pasted id", () => {
    // The old field asked for a posting ID: a string an instructor had no way
    // to see without leaving the page.
    const html = render();
    assert.ok(!html.includes('name="jobListingId" required class'), "no bare text input");
    assert.ok(SOURCE.includes('name="jobListingId"'), SOURCE.slice(0, 0));
    assert.ok(
      SOURCE.includes("Which job on the board"),
      "the picker's label should name what it is choosing",
    );
  });

  it("loads the picker's options from the class board endpoint", () => {
    assert.ok(
      SOURCE.includes("/api/teacher/connect/leads/listings?classId="),
      "the options come from the class's own board",
    );
  });

  it("resets and refreshes after a successful add", () => {
    assert.ok(SOURCE.includes("formRef.current?.reset()"), "a stale form invites a duplicate lead");
    assert.ok(SOURCE.includes("router.refresh()"), "the new lead must appear on the board");
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
