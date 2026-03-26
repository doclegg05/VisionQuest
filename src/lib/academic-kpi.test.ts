import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAcademicKpis, type KpiStudentRow } from "./academic-kpi";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeStudent(overrides: Partial<KpiStudentRow> = {}): KpiStudentRow {
  return {
    id: overrides.id ?? "s1",
    createdAt: overrides.createdAt ?? new Date("2026-01-01"),
    conversations: overrides.conversations ?? [],
    goals: overrides.goals ?? [],
    progressionState: overrides.progressionState ?? null,
    certifications: overrides.certifications ?? [],
    portfolioItems: overrides.portfolioItems ?? [],
    resumeData: overrides.resumeData ?? null,
    publicCredentialPage: overrides.publicCredentialPage ?? null,
    orientationProgress: overrides.orientationProgress ?? [],
  };
}

function makeGoal(
  overrides: Partial<KpiStudentRow["goals"][0]> = {},
): KpiStudentRow["goals"][0] {
  return {
    id: overrides.id ?? "g1",
    level: overrides.level ?? "bhag",
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? new Date("2026-01-10"),
    resourceLinks: overrides.resourceLinks ?? [],
  };
}

function makeLink(
  overrides: Partial<KpiStudentRow["goals"][0]["resourceLinks"][0]> = {},
): KpiStudentRow["goals"][0]["resourceLinks"][0] {
  return {
    id: overrides.id ?? "l1",
    linkType: overrides.linkType ?? "assigned",
    status: overrides.status ?? "assigned",
    createdAt: overrides.createdAt ?? new Date("2026-01-15"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-15"),
  };
}

const NOW = new Date("2026-03-23");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeAcademicKpis", () => {
  it("returns zeroed payload for empty student list", () => {
    const result = computeAcademicKpis([], NOW);
    assert.equal(result.goalAdoption.totalStudents, 0);
    assert.equal(result.goalAdoption.withBhag, 0);
    assert.equal(result.goalAdoption.withBhagPct, 0);
    assert.equal(result.resourcePipeline.totalAssignedLinks, 0);
    assert.equal(result.timeToMilestone.medianDaysToFirstGoal, null);
    assert.equal(result.readinessDistribution.medianScore, null);
    assert.equal(result.academicFunnel.length, 8);
    assert.equal(result.academicFunnel[0].value, 0);
  });

  it("counts BHAG adoption correctly and excludes abandoned goals", () => {
    const students = [
      makeStudent({
        id: "s1",
        goals: [makeGoal({ level: "bhag", status: "active" })],
      }),
      makeStudent({
        id: "s2",
        goals: [makeGoal({ level: "bhag", status: "abandoned" })],
      }),
      makeStudent({
        id: "s3",
        goals: [makeGoal({ level: "bhag", status: "in_progress" })],
      }),
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.goalAdoption.withBhag, 2);
    assert.equal(result.goalAdoption.withBhagPct, 67);
  });

  it("counts monthly and weekly goal adoption", () => {
    const students = [
      makeStudent({
        id: "s1",
        goals: [
          makeGoal({ level: "bhag", status: "active" }),
          makeGoal({ id: "g2", level: "monthly", status: "active" }),
          makeGoal({ id: "g3", level: "weekly", status: "active" }),
        ],
      }),
      makeStudent({
        id: "s2",
        goals: [makeGoal({ level: "monthly", status: "completed" })],
      }),
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.goalAdoption.withMonthlyGoal, 2);
    assert.equal(result.goalAdoption.withWeeklyGoal, 1);
  });

  it("counts goals with assigned resources correctly", () => {
    const students = [
      makeStudent({
        id: "s1",
        goals: [
          makeGoal({
            id: "g1",
            status: "active",
            resourceLinks: [makeLink({ linkType: "assigned" })],
          }),
          makeGoal({ id: "g2", status: "active", resourceLinks: [] }),
        ],
      }),
      makeStudent({
        id: "s2",
        goals: [
          makeGoal({
            id: "g3",
            status: "active",
            resourceLinks: [makeLink({ id: "l2", linkType: "assigned" })],
          }),
          makeGoal({
            id: "g4",
            status: "active",
            resourceLinks: [makeLink({ id: "l3", linkType: "recommended" })],
          }),
        ],
      }),
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.goalAdoption.totalActiveGoals, 4);
    assert.equal(result.goalAdoption.goalsWithLinkedResources, 2);
    assert.equal(result.goalAdoption.goalsWithResourcesPct, 50);
  });

  it("computes resource-to-evidence pipeline", () => {
    const students = [
      makeStudent({
        id: "s1",
        goals: [
          makeGoal({
            status: "active",
            resourceLinks: [
              makeLink({ id: "l1", status: "in_progress" }),
              makeLink({ id: "l2", status: "completed" }),
              makeLink({ id: "l3", status: "assigned" }),
            ],
          }),
        ],
      }),
      makeStudent({
        id: "s2",
        goals: [
          makeGoal({
            status: "active",
            resourceLinks: [
              makeLink({ id: "l4", status: "assigned" }),
              makeLink({ id: "l5", status: "blocked" }),
            ],
          }),
        ],
      }),
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.resourcePipeline.totalAssignedLinks, 5);
    assert.equal(result.resourcePipeline.linksWithEvidence, 3); // in_progress, completed, blocked
    assert.equal(result.resourcePipeline.linksCompleted, 1);
    assert.equal(result.resourcePipeline.studentsWithAnyEvidence, 2);
  });

  it("computes median and average days to first goal", () => {
    const students = [
      makeStudent({
        id: "s1",
        createdAt: new Date("2026-01-01"),
        goals: [makeGoal({ createdAt: new Date("2026-01-11") })], // 10 days
      }),
      makeStudent({
        id: "s2",
        createdAt: new Date("2026-01-01"),
        goals: [makeGoal({ createdAt: new Date("2026-01-21") })], // 20 days
      }),
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.timeToMilestone.medianDaysToFirstGoal, 15);
    assert.equal(result.timeToMilestone.avgDaysToFirstGoal, 15);
  });

  it("computes time from goal to resource and resource to evidence", () => {
    const students = [
      makeStudent({
        id: "s1",
        goals: [
          makeGoal({
            createdAt: new Date("2026-01-10"),
            resourceLinks: [
              makeLink({
                createdAt: new Date("2026-01-15"), // 5 days after goal
                updatedAt: new Date("2026-01-20"), // 5 days after assignment
                status: "in_progress",
              }),
            ],
          }),
        ],
      }),
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.timeToMilestone.medianDaysGoalToResource, 5);
    assert.equal(result.timeToMilestone.medianDaysResourceToEvidence, 5);
  });

  it("bins readiness scores into correct buckets", () => {
    const makeProgState = (level: number, certs: number) =>
      JSON.stringify({
        level,
        xp: 0,
        completedGoalLevels: [],
        certificationsEarned: certs,
        portfolioItemCount: 0,
        resumeCreated: false,
        portfolioShared: false,
        platformsVisited: [],
        longestStreak: 0,
        orientationComplete: false,
      });

    const students = [
      makeStudent({ id: "s1", progressionState: makeProgState(1, 0) }),  // score ~0
      makeStudent({ id: "s2", progressionState: makeProgState(3, 5) }),  // mid score
      makeStudent({ id: "s3", progressionState: makeProgState(5, 19) }), // high score
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.readinessDistribution.distribution.length, 5);
    const totalBucketed = result.readinessDistribution.distribution.reduce(
      (sum, b) => sum + b.count,
      0,
    );
    assert.equal(totalBucketed, 3);
    assert.notEqual(result.readinessDistribution.medianScore, null);
    assert.notEqual(result.readinessDistribution.avgScore, null);
  });

  it("builds academic conversion funnel with correct step order", () => {
    const students = [
      makeStudent({
        id: "s1",
        conversations: [{ createdAt: new Date("2026-01-02") }],
        goals: [
          makeGoal({
            level: "bhag",
            status: "active",
            resourceLinks: [makeLink({ status: "in_progress" })],
          }),
          makeGoal({ id: "g2", level: "monthly", status: "active" }),
        ],
        certifications: [{ status: "in_progress", startedAt: new Date("2026-02-01"), completedAt: null }],
      }),
      makeStudent({
        id: "s2",
        conversations: [{ createdAt: new Date("2026-01-03") }],
        goals: [makeGoal({ level: "bhag", status: "active" })],
      }),
      makeStudent({
        id: "s3",
        conversations: [],
        goals: [],
      }),
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.academicFunnel[0].label, "Enrolled");
    assert.equal(result.academicFunnel[0].value, 3);
    assert.equal(result.academicFunnel[1].label, "First Sage conversation");
    assert.equal(result.academicFunnel[1].value, 2);
    assert.equal(result.academicFunnel[2].label, "Confirmed BHAG");
    assert.equal(result.academicFunnel[2].value, 2);
    assert.equal(result.academicFunnel[3].label, "Active monthly plan");
    assert.equal(result.academicFunnel[3].value, 1);
    assert.equal(result.academicFunnel[4].label, "Assigned resource");
    assert.equal(result.academicFunnel[4].value, 1);
    assert.equal(result.academicFunnel[5].label, "Evidence submitted");
    assert.equal(result.academicFunnel[5].value, 1);
    assert.equal(result.academicFunnel[6].label, "Certification progress");
    assert.equal(result.academicFunnel[6].value, 1);
  });

  it("computes readiness above-50 and above-75 counts", () => {
    // High progression state: level 5 + all certs + orientation + resume + portfolio
    const highState = JSON.stringify({
      level: 5,
      xp: 1500,
      completedGoalLevels: ["bhag", "monthly", "weekly", "daily", "task"],
      certificationsEarned: 19,
      portfolioItemCount: 5,
      resumeCreated: true,
      portfolioShared: true,
      platformsVisited: Array.from({ length: 13 }, (_, i) => `p${i}`),
      longestStreak: 30,
      orientationComplete: true,
    });

    // Low state: defaults (level 1, nothing done)
    const students = [
      makeStudent({ id: "s1", progressionState: highState }), // score = 100
      makeStudent({ id: "s2", progressionState: highState }), // score = 100
      makeStudent({ id: "s3", progressionState: null }),       // score = 0
    ];

    const result = computeAcademicKpis(students, NOW);
    assert.equal(result.readinessDistribution.studentsAbove50, 2);
    assert.equal(result.readinessDistribution.studentsAbove75, 2);
    assert.equal(result.readinessDistribution.studentsAbove50Pct, 67);
    assert.equal(result.readinessDistribution.studentsAbove75Pct, 67);
  });
});
