import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoalEvidenceEntries,
  buildGoalReviewQueue,
} from "@/lib/goal-evidence";
import { createInitialState } from "@/lib/progression/engine";
import type { GoalResourceLinkView } from "@/lib/goal-resource-links";

function makeLink(overrides: Partial<GoalResourceLinkView> = {}): GoalResourceLinkView {
  return {
    id: "link-1",
    goalId: "goal-1",
    resourceType: "form",
    resourceId: "student-profile",
    title: "Student Profile",
    description: "Complete your intake form",
    url: null,
    linkType: "assigned",
    status: "assigned",
    dueAt: null,
    notes: null,
    assignedById: "teacher-1",
    createdAt: "2026-03-01T12:00:00.000Z",
    updatedAt: "2026-03-01T12:00:00.000Z",
    ...overrides,
  };
}

test("buildGoalEvidenceEntries marks pending form submissions as awaiting review", () => {
  const [evidence] = buildGoalEvidenceEntries({
    links: [makeLink()],
    progressionState: createInitialState(),
    formSubmissions: [{
      id: "submission-1",
      formId: "student-profile",
      status: "pending",
      createdAt: "2026-03-02T12:00:00.000Z",
      updatedAt: "2026-03-02T12:00:00.000Z",
      reviewedAt: null,
      notes: null,
    }],
  });

  assert.ok(evidence);
  assert.equal(evidence.evidenceStatus, "submitted");
  assert.equal(evidence.reviewNeeded, true);
  assert.match(evidence.summary, /waiting for instructor review/i);
});

test("buildGoalReviewQueue flags planning goals without assigned resources", () => {
  const queue = buildGoalReviewQueue({
    goals: [{
      id: "goal-1",
      content: "Finish my enrollment paperwork.",
      status: "active",
      createdAt: "2026-03-10T12:00:00.000Z",
    }],
    links: [],
    evidenceEntries: [],
    now: new Date("2026-03-12T12:00:00.000Z"),
  });

  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.kind, "goal_needs_resource");
});

test("buildGoalReviewQueue flags stale assigned resources with no evidence after seven days", () => {
  const queue = buildGoalReviewQueue({
    goals: [{
      id: "goal-1",
      content: "Start using GMetrix for certification practice.",
      status: "active",
      createdAt: "2026-03-01T12:00:00.000Z",
    }],
    links: [
      makeLink({
        resourceType: "platform",
        resourceId: "gmetrix-and-learnkey",
        title: "GMetrix and LearnKey",
        createdAt: "2026-03-01T12:00:00.000Z",
      }),
    ],
    evidenceEntries: buildGoalEvidenceEntries({
      links: [
        makeLink({
          resourceType: "platform",
          resourceId: "gmetrix-and-learnkey",
          title: "GMetrix and LearnKey",
          createdAt: "2026-03-01T12:00:00.000Z",
        }),
      ],
      progressionState: createInitialState(),
    }),
    now: new Date("2026-03-10T12:00:00.000Z"),
  });

  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.kind, "goal_resource_stale");
});

test("buildGoalEvidenceEntries recognizes completed portfolio tasks from system evidence", () => {
  const [evidence] = buildGoalEvidenceEntries({
    links: [
      makeLink({
        resourceType: "portfolio_task",
        resourceId: "portfolio-proof",
        title: "Add a portfolio work sample",
      }),
    ],
    progressionState: createInitialState(),
    portfolioItems: [{
      id: "portfolio-1",
      title: "Customer service award",
      type: "award",
      createdAt: "2026-03-03T12:00:00.000Z",
      updatedAt: "2026-03-03T12:00:00.000Z",
    }],
  });

  assert.ok(evidence);
  assert.equal(evidence.evidenceStatus, "completed");
  assert.equal(evidence.reviewNeeded, false);
});

test("buildGoalEvidenceEntries recognizes application and event career steps from tracked outcomes", () => {
  const evidence = buildGoalEvidenceEntries({
    links: [
      makeLink({
        id: "career-1",
        resourceType: "career_step",
        resourceId: "application-submit",
        title: "Submit an application",
      }),
      makeLink({
        id: "career-2",
        resourceType: "career_step",
        resourceId: "event-register",
        title: "Register for a career event",
      }),
    ],
    progressionState: createInitialState(),
    applications: [{
      id: "application-1",
      status: "applied",
      updatedAt: "2026-03-05T12:00:00.000Z",
      appliedAt: "2026-03-05T12:00:00.000Z",
    }],
    eventRegistrations: [{
      id: "event-1",
      status: "registered",
      updatedAt: "2026-03-06T12:00:00.000Z",
      registeredAt: "2026-03-06T12:00:00.000Z",
    }],
  });

  assert.equal(evidence[0]?.evidenceStatus, "completed");
  assert.equal(evidence[1]?.evidenceStatus, "completed");
});
