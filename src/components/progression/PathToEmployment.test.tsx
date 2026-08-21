import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import type { PathStep } from "@/lib/progression/student-next-step";
import {
  PathToEmployment,
  stepStatusPhrase,
  type PathToEmploymentProps,
} from "./PathToEmployment";

/**
 * The strip's two jobs, per the 2026-08-20 UX review of the mobile student
 * pages: (1) at phone widths the eight-circle row must collapse to a
 * one-step summary instead of wrapping into rows of locked circles, and
 * (2) step state must be real text (visually hidden), never title-attribute
 * tooltips that touch and keyboard users can't reach.
 */

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function buildSteps(): PathStep[] {
  return [
    { key: "orientation", label: "Orientation", status: "complete", description: "Finish program basics" },
    { key: "discover", label: "Discover", status: "active", description: "Explore career paths" },
    { key: "goal", label: "Goal", status: "locked", description: "Set career focus" },
    { key: "learn", label: "Learn", status: "locked", description: "Build skills" },
    { key: "prove", label: "Prove", status: "locked", description: "Collect proof" },
    { key: "prepare", label: "Prepare", status: "locked", description: "Ready your resume" },
    { key: "apply", label: "Apply", status: "locked", description: "Track opportunities" },
    { key: "followUp", label: "Follow Up", status: "locked", description: "Handle next steps" },
  ];
}

function baseProps(): PathToEmploymentProps {
  return {
    currentStepKey: "discover",
    title: "Talk to Sage about your career interests",
    description: "Chat with Sage to explore your strengths, interests, and matching career paths.",
    whyItMatters: "Knowing your target career field helps you focus your study on jobs that fit you.",
    actionLabel: "Chat with Sage",
    actionLink: "/chat",
    steps: buildSteps(),
  };
}

function blockedProps(): PathToEmploymentProps {
  const steps = buildSteps().map((step) =>
    step.key === "followUp" ? { ...step, status: "blocked" as const } : { ...step, status: "complete" as const },
  );
  return {
    ...baseProps(),
    currentStepKey: "followUp",
    actionLabel: "View Advising",
    actionLink: "/appointments",
    steps,
  };
}

describe("stepStatusPhrase", () => {
  it("names the current step once, in plain words, whatever its raw status", () => {
    const step = buildSteps()[1];
    assert.equal(stepStatusPhrase(step, true), "This is your next step.");
  });

  it("maps every status to a plain phrase — no raw enum ever reaches a screen reader", () => {
    const [complete, , locked] = buildSteps();
    assert.equal(stepStatusPhrase(complete, false), "Done.");
    assert.equal(stepStatusPhrase(locked, false), "Locked. Finish the earlier steps first.");
    assert.equal(stepStatusPhrase({ ...locked, status: "available" }, false), "Ready to start.");
    assert.equal(stepStatusPhrase({ ...locked, status: "blocked" }, false), "Needs attention.");
  });
});

describe("PathToEmployment — full variant", () => {
  it("renders the Do-this-next card with exactly one CTA and no old badge copy", () => {
    const html = renderToString(<PathToEmployment {...baseProps()} />);

    assert.equal(count(html, 'data-testid="current-target-cta"'), 1);
    assert.equal(count(html, "Do this next"), 1);
    assert.ok(!html.includes("Current Target"), "the uppercase jargon badge must be gone");
  });

  it("carries no title-attribute tooltips — step descriptions are real (hidden) text", () => {
    const html = renderToString(<PathToEmployment {...baseProps()} />);

    assert.ok(!/ title="/.test(html), "title attributes are invisible to touch and keyboard users");
    assert.ok(html.includes("Explore career paths"), "the description text must still be present");
  });

  it("describes each step's state in plain words for screen readers", () => {
    const html = renderToString(<PathToEmployment {...baseProps()} />);

    assert.ok(html.includes("This is your next step."));
    assert.ok(html.includes("Done."));
    assert.ok(html.includes("Locked. Finish the earlier steps first."));
    assert.ok(!html.includes("(locked)"), "raw status enums must not be announced");
    assert.ok(!html.includes("(active)"));
  });

  it("collapses to a one-step summary on mobile and keeps the full strip from md: up", () => {
    const html = renderToString(<PathToEmployment {...baseProps()} />);

    assert.ok(html.includes("Step 2 of 8"), "the summary names the student's place on the path");

    const summaryTag = html.match(/<div[^>]*data-testid="journey-step-summary"[^>]*>/)?.[0];
    assert.ok(summaryTag, "mobile summary block must exist");
    assert.ok(summaryTag.includes("md:hidden"), "the summary is mobile-only");

    const stripTag = html.match(/<ol[^>]*>/)?.[0];
    assert.ok(stripTag, "the full strip must exist");
    assert.ok(stripTag.includes('data-testid="journey-steps"'));
    assert.ok(stripTag.includes("hidden") && stripTag.includes("md:flex"), "the strip is desktop-only");
    assert.ok(!html.includes("min-w-[120px]"), "the per-step min width caused the 4-row wrap at 375px");
  });

  it("shows the Needs-attention chip when the current step is blocked", () => {
    const html = renderToString(<PathToEmployment {...blockedProps()} />);

    assert.ok(html.includes("Needs attention"));
  });
});

describe("PathToEmployment — compact variant", () => {
  it("renders one link naming the next step, not the full card", () => {
    const html = renderToString(<PathToEmployment {...baseProps()} variant="compact" />);

    assert.equal(count(html, 'data-testid="current-target-cta"'), 1);
    assert.ok(html.includes("Next:"));
    assert.ok(html.includes("Discover"));
    assert.ok(html.includes("Step 2 of 8"));
    assert.match(html, /href="\/chat"/);
  });

  it("keeps the page light: no badge, no why-it-matters, no tooltips", () => {
    const props = baseProps();
    const html = renderToString(<PathToEmployment {...props} variant="compact" />);

    assert.ok(!html.includes("Do this next"));
    assert.ok(!html.includes(props.whyItMatters));
    assert.ok(!/ title="/.test(html));
  });

  it("flags a blocked step so the one-liner never hides a problem", () => {
    const html = renderToString(<PathToEmployment {...blockedProps()} variant="compact" />);

    assert.ok(html.includes("Needs attention."));
    assert.match(html, /href="\/appointments"/);
  });
});
