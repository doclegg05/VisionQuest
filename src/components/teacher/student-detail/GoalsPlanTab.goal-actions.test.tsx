import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import GoalsPlanTab, { goalButtonFor, type GoalButton } from "./GoalsPlanTab";
import type { GoalData, StudentData } from "./types";

/**
 * Confirm and Mark Reviewed sent a request per tap. A double tap sent two, and
 * the second could fail on a goal the first had already changed, so the page
 * showed a failure for an action that worked. The page sends one goal action
 * at a time, so while one is in flight every goal button is off: a tap that
 * would be ignored has to look disabled. The button that was pressed reads
 * "Saving...".
 */

const part = { score: 0, max: 10, label: "" };

function goal(id: string): GoalData {
  return {
    id,
    level: "monthly",
    content: `Goal ${id}`,
    status: "proposed",
    parentId: null,
    pathwayId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    pathway: null,
  };
}

function data(goals: GoalData[]): StudentData {
  return {
    student: {
      id: "stu-1",
      studentId: "dana.rivers",
      displayName: "Dana Rivers",
      email: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      isActive: true,
      programType: "spokes",
    },
    progression: { xp: 0, level: 1, streaks: { daily: { current: 0, longest: 0 } }, achievements: [] },
    readinessScore: 0,
    readinessBreakdown: {
      orientation: part,
      goalPlanning: part,
      bhagAchieved: part,
      certifications: part,
      portfolio: part,
      consistency: part,
    },
    goals,
    goalPlans: [],
    goalEvidence: [],
    reviewQueue: [],
    formSubmissions: [],
    orientation: { items: [], progress: [] },
    certification: { templates: [], cert: null },
    publicCredentialPage: null,
    applications: [],
    eventRegistrations: [],
    portfolio: [],
    hasResume: false,
    files: [],
    appointments: [],
    tasks: [],
    notes: [],
    alerts: [],
    conversations: [],
    careerDiscovery: null,
    workProfile: null,
  };
}

/** The four buttons in page order: g1 Confirm, g1 Mark Reviewed, g2 Confirm, g2 Mark Reviewed. */
function goalButtons(goalActionId: string | null, goalActionButton: GoalButton | null = null): string[] {
  const html = renderToString(
    <GoalsPlanTab
      data={data([goal("g1"), goal("g2")])}
      dateFormatter={new Intl.DateTimeFormat("en-US", { timeZone: "UTC" })}
      onChanged={async () => {}}
      onGoalAction={async () => {}}
      goalActionId={goalActionId}
      goalActionButton={goalActionButton}
    />,
  );
  return html.match(/<button\b[^>]*>(?:Confirm|Mark Reviewed|Saving\.\.\.)<\/button>/gu) ?? [];
}

const DISABLED = /\sdisabled=""/u;
const label = (button: string) => button.replace(/<[^>]+>/gu, "");

describe("goal Confirm and Mark Reviewed", () => {
  it("are all on, with their own words, when nothing is in flight", () => {
    const buttons = goalButtons(null);
    assert.deepEqual(buttons.map(label), ["Confirm", "Mark Reviewed", "Confirm", "Mark Reviewed"]);
    for (const button of buttons) assert.doesNotMatch(button, DISABLED);
  });

  it("turn off every goal's buttons while one goal action is in flight", () => {
    const buttons = goalButtons("g1", "confirm");
    assert.equal(buttons.length, 4);
    for (const button of buttons) assert.match(button, DISABLED);
  });

  it("say Saving... on the button that was pressed, and on no other", () => {
    assert.deepEqual(goalButtons("g1", "confirm").map(label), ["Saving...", "Mark Reviewed", "Confirm", "Mark Reviewed"]);
    assert.deepEqual(goalButtons("g2", "reviewed").map(label), ["Confirm", "Mark Reviewed", "Confirm", "Saving..."]);
  });

  it("turn off but keep their words while a pathway change on a goal is in flight", () => {
    const buttons = goalButtons("g1", null);
    assert.deepEqual(buttons.map(label), ["Confirm", "Mark Reviewed", "Confirm", "Mark Reviewed"]);
    for (const button of buttons) assert.match(button, DISABLED);
  });
});

describe("goalButtonFor: which button a goal action came from", () => {
  it("names Confirm and Mark Reviewed", () => {
    assert.equal(goalButtonFor({ confirm: true }), "confirm");
    assert.equal(goalButtonFor({ reviewed: true }), "reviewed");
  });

  it("names no button for a change made somewhere else, such as a pathway", () => {
    assert.equal(goalButtonFor({ pathwayId: "path-1" }), null);
    assert.equal(goalButtonFor({ confirm: false }), null);
    assert.equal(goalButtonFor({}), null);
  });
});
