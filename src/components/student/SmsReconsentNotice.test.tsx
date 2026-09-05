import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { SmsReconsentNotice } from "./SmsReconsentNotice";

/**
 * Who sees this, and what it says.
 *
 * The population is decided on the server by the page that renders it, which
 * is the fix for the bug this component shipped with: it began as a client
 * fetch inside DashboardClient, and DashboardClient is also mounted by the
 * teacher's student-detail dashboard — so a teacher reading a student's page
 * was shown a notice about the teacher's own phone preferences.
 */
describe("SmsReconsentNotice", () => {
  it("renders nothing at all when the student's texts are not paused", () => {
    assert.equal(renderToString(<SmsReconsentNotice show={false} />), "");
  });

  it("names the problem and the one action, in plain words", () => {
    const html = renderToString(<SmsReconsentNotice show />);
    assert.match(html, /Text messages are paused/);
    assert.match(html, /Turn texts back on/);
    assert.match(html, /href="\/settings"/);
  });

  it("does not give the dismiss button an aria-label that hides its words", () => {
    // WCAG 2.5.3 Label in Name: a voice-control user says what they see, so
    // an accessible name of "Hide this message" makes "Not now" unspeakable.
    const html = renderToString(<SmsReconsentNotice show />);
    assert.match(html, />Not now</);
    assert.doesNotMatch(html, /aria-label="Hide this message"/);
  });

  it("keeps the dismiss control at the 44px touch-target floor", () => {
    const html = renderToString(<SmsReconsentNotice show />);
    assert.match(html, /min-h-11 min-w-11/);
  });
});
