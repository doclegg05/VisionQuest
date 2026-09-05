import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { CareerOneStopUnconfiguredNotice, shouldShowCareerOneStopNudge } from "./JobConfigSection";
import type { JobSourceHealthResult } from "@/lib/job-board/types";
import { assessReadability, PLAIN_LANGUAGE_MAX_GRADE } from "@/lib/sage/readability";

const CONFIGURED_HEALTH: JobSourceHealthResult = {
  source: "careeronestop",
  label: "WV Local Jobs — state job bank",
  selected: true,
  configured: true,
  recentRuns: 0,
  successRate: null,
  lastStatus: null,
  lastFetchedCount: 0,
  lastUpsertedCount: 0,
  lastError: null,
  lastStartedAt: null,
  lastCompletedAt: null,
};

const UNCONFIGURED_HEALTH: JobSourceHealthResult = { ...CONFIGURED_HEALTH, configured: false };

describe("shouldShowCareerOneStopNudge", () => {
  it("is false when careeronestop is not among the selected sources", () => {
    assert.equal(shouldShowCareerOneStopNudge(["usajobs"], [UNCONFIGURED_HEALTH]), false);
  });

  it("is false when source health has not loaded yet", () => {
    assert.equal(shouldShowCareerOneStopNudge(["careeronestop"], []), false);
  });

  it("is false when careeronestop is selected and configured", () => {
    assert.equal(shouldShowCareerOneStopNudge(["careeronestop"], [CONFIGURED_HEALTH]), false);
  });

  it("is true when careeronestop is selected but not configured", () => {
    assert.equal(shouldShowCareerOneStopNudge(["careeronestop"], [UNCONFIGURED_HEALTH]), true);
  });
});

describe("CareerOneStopUnconfiguredNotice", () => {
  it("renders nothing when careeronestop is configured", () => {
    const html = renderToString(
      <CareerOneStopUnconfiguredNotice sources={["careeronestop"]} sourceHealth={[CONFIGURED_HEALTH]} />,
    );
    assert.equal(html, "");
  });

  it("renders the grade-6 nudge copy when careeronestop is selected but unconfigured", () => {
    const html = renderToString(
      <CareerOneStopUnconfiguredNotice sources={["careeronestop"]} sourceHealth={[UNCONFIGURED_HEALTH]} />,
    );
    assert.ok(html.includes("WV Local Jobs is not on yet."));
    assert.ok(html.includes("Ask your admin to add the CareerOneStop keys."));
  });

  it("marks the notice role=\"alert\" so screen readers announce it, per the house pattern (StructuredFormsSection, InterventionQueuePanel)", () => {
    const html = renderToString(
      <CareerOneStopUnconfiguredNotice sources={["careeronestop"]} sourceHealth={[UNCONFIGURED_HEALTH]} />,
    );
    assert.ok(html.includes('role="alert"'), html);
  });

  it("scores at or under the grade-6/8 readability ceiling, so the 'grade-6' claim is enforced, not asserted", () => {
    const text = "WV Local Jobs is not on yet. Ask your admin to add the CareerOneStop keys.";
    const assessment = assessReadability(text);
    assert.ok(assessment.scorable, "expected the notice text to be long enough to score");
    assert.ok(
      assessment.grade <= PLAIN_LANGUAGE_MAX_GRADE,
      `notice text scored grade ${assessment.grade}, above the ${PLAIN_LANGUAGE_MAX_GRADE} ceiling`,
    );
  });
});
