import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import WizardStepIndicator from "./WizardStepIndicator";

// The SPOKES orientation packet is 16 documents. An unwrapped row of 16 32px
// circles plus connectors is wider than the card that holds it, so the last
// numbers rendered past its right edge. These pin the two properties that keep
// that from coming back: the strip wraps, and phones get a bar instead.

const SIXTEEN = { totalSteps: 16, currentStep: 0, currentTitle: "Rights and Responsibilities" };

describe("WizardStepIndicator", () => {
  it("wraps the dot strip so it cannot run past the card edge", () => {
    const html = renderToString(<WizardStepIndicator {...SIXTEEN} />);
    const stripMatch = html.match(/class="[^"]*\bmd:flex\b[^"]*"/);
    assert.ok(stripMatch, "expected a md:flex dot strip");
    assert.match(
      stripMatch[0],
      /\bflex-wrap\b/,
      "the dot strip must wrap — without it 16 steps overflow the card",
    );
  });

  it("renders a bar instead of dots below md", () => {
    const html = renderToString(<WizardStepIndicator {...SIXTEEN} />);
    // The dots are md-and-up only...
    assert.match(html, /class="hidden flex-wrap[^"]*md:flex/);
    // ...and the bar is the small-screen view.
    assert.match(html, /md:hidden/);
  });

  it("exposes exactly one progressbar carrying the step position", () => {
    const html = renderToString(<WizardStepIndicator totalSteps={16} currentStep={2} currentTitle="Code of Conduct" />);
    assert.equal(html.match(/role="progressbar"/g)?.length, 1);
    assert.match(html, /aria-valuenow="3"/);
    assert.match(html, /aria-valuemax="16"/);
    assert.match(html, /aria-label="Step 3 of 16: Code of Conduct"/);
  });

  it("fills the bar by position, and never past 100%", () => {
    const mid = renderToString(<WizardStepIndicator totalSteps={16} currentStep={7} currentTitle="Mid" />);
    assert.match(mid, /width:50%/);

    const last = renderToString(<WizardStepIndicator totalSteps={16} currentStep={15} currentTitle="Last" />);
    assert.match(last, /width:100%/);
  });

  it("does not divide by zero when there are no steps", () => {
    const html = renderToString(<WizardStepIndicator totalSteps={0} currentStep={0} currentTitle="None" />);
    assert.match(html, /width:0%/);
    assert.ok(!html.includes("NaN"));
  });

  it("still marks the current step and completed steps", () => {
    const html = renderToString(<WizardStepIndicator totalSteps={4} currentStep={2} currentTitle="Third" />);
    assert.match(html, /aria-current="step"/);
    assert.ok(html.includes("✓"), "completed steps render a check");
  });
});
