import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import GoalsPlanTab from "./GoalsPlanTab";
import type { GoalData, StudentData } from "./types";

/**
 * Confirm and Mark Reviewed sent a request per tap. A double tap sent two, and
 * the second could fail on a goal the first had already changed, so the page
 * showed a failure for an action that worked. While a goal's action is in
 * flight, both of its buttons are off.
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

function goalButtons(goalActionId: string | null): string[] {
  const html = renderToString(
    <GoalsPlanTab
      data={data([goal("g1"), goal("g2")])}
      dateFormatter={new Intl.DateTimeFormat("en-US", { timeZone: "UTC" })}
      onChanged={async () => {}}
      onGoalAction={async () => {}}
      goalActionId={goalActionId}
    />,
  );
  return html.match(/<button\b[^>]*>(?:Confirm|Mark Reviewed)<\/button>/gu) ?? [];
}

const DISABLED = /\sdisabled=""/u;

describe("goal Confirm and Mark Reviewed", () => {
  it("are both on when nothing is in flight", () => {
    const buttons = goalButtons(null);
    assert.equal(buttons.length, 4);
    for (const button of buttons) assert.doesNotMatch(button, DISABLED);
  });

  it("turn off both buttons of the goal in flight, and only that goal's", () => {
    const [confirm1, reviewed1, confirm2, reviewed2] = goalButtons("g1");
    assert.match(confirm1, DISABLED);
    assert.match(reviewed1, DISABLED);
    assert.doesNotMatch(confirm2, DISABLED);
    assert.doesNotMatch(reviewed2, DISABLED);
  });
});
