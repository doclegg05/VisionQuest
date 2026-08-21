import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCareerProfileContext,
  formatPriorConversationContext,
  shouldLoadCoachingArcContext,
  shouldLoadPathwayContext,
  shouldLoadSkillGapContext,
} from "./context";

test("formatPriorConversationContext returns an empty string when there are no prior summaries", () => {
  assert.equal(formatPriorConversationContext([]), "");
});

test("formatPriorConversationContext wraps summaries in explicit markers", () => {
  const output = formatPriorConversationContext([
    {
      summary: "Student committed to weekly applications.",
      module: "goal",
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    },
  ]);

  assert.match(output, /\[PREVIOUS_CONVERSATIONS_START\]/);
  assert.match(output, /Session from 2026-04-01 \(goal\): Student committed to weekly applications\./);
  assert.match(output, /\[PREVIOUS_CONVERSATIONS_END\]/);
});

test("buildCareerProfileContext returns undefined when discovery is incomplete", () => {
  assert.equal(
    buildCareerProfileContext({
      status: "draft",
      sageSummary: null,
      topClusters: [],
      hollandCode: null,
      riasecScores: null,
      nationalClusters: null,
      transferableSkills: null,
      workValues: null,
    }),
    undefined,
  );
});

test("buildCareerProfileContext formats top-level career profile sections", () => {
  const output = buildCareerProfileContext({
    status: "complete",
    sageSummary: "Strong fit for office administration and finance pathways.",
    topClusters: ["Office & Admin", "Finance"],
    hollandCode: "CES",
    riasecScores: JSON.stringify({ Conventional: 0.88, Enterprising: 0.62 }),
    // "Finance" is a retired 16-framework name (→ Financial Services);
    // "Office Administration" was never a national cluster and must pass
    // through untouched rather than be destroyed at read time.
    nationalClusters: JSON.stringify([
      { cluster_name: "Office Administration", score: 0.91 },
      { cluster_name: "Finance", score: 0.73 },
    ]),
    transferableSkills: JSON.stringify([
      {
        skill: "Scheduling",
        category: "Operations",
        evidence: "Manages appointments for family members",
      },
    ]),
    workValues: JSON.stringify([
      { value: "Stability", importance: "high" },
    ]),
  });

  assert.ok(output);
  assert.match(output!, /Holland Code: CES/);
  assert.match(output!, /RIASEC Scores:/);
  assert.match(output!, /Transferable Skills:/);
  assert.match(output!, /Top Career Clusters:/);
  // Legacy stored name renders as its modernized cluster; unknown names
  // pass through unchanged.
  assert.match(output!, /Financial Services \(73% match\)/);
  assert.match(output!, /Office Administration \(91% match\)/);
  assert.doesNotMatch(output!, /- Finance \(/);
  assert.match(output!, /Assessment Summary:/);
});

test("stage helpers only enable heavy prompt context where it is used", () => {
  assert.equal(shouldLoadSkillGapContext("weekly", "complete"), true);
  assert.equal(shouldLoadSkillGapContext("general", "complete"), false);
  assert.equal(shouldLoadSkillGapContext("weekly", "draft"), false);

  assert.equal(shouldLoadPathwayContext("tasks"), true);
  assert.equal(shouldLoadPathwayContext("review"), false);

  assert.equal(shouldLoadCoachingArcContext("checkin"), true);
  assert.equal(shouldLoadCoachingArcContext("orientation"), false);
});
