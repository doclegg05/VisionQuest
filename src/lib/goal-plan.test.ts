import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/db";
import { buildGoalPlanEntries } from "@/lib/goal-plan";

test("buildGoalPlanEntries recommends onboarding forms, orientation steps, and portfolio tasks", async () => {
  const originalProgramFindMany = prisma.programDocument.findMany;
  const originalOrientationFindMany = prisma.orientationItem.findMany;
  const originalOpportunityFindMany = prisma.opportunity.findMany;
  const originalEventFindMany = prisma.careerEvent.findMany;

  try {
    (
      prisma.programDocument.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [];
    (
      prisma.orientationItem.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [
      {
        id: "orientation-profile",
        label: "Complete student profile",
        description: "Finish the intake paperwork for the program",
        required: true,
        sortOrder: 1,
      },
      {
        id: "orientation-tech",
        label: "Review classroom technology",
        description: "Learn the tools you will use in class",
        required: true,
        sortOrder: 2,
      },
    ];
    (
      prisma.opportunity.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [
      {
        id: "opp-1",
        title: "Office Assistant",
        company: "City Library",
        type: "job",
        description: "Support front desk and scheduling tasks.",
        deadline: new Date("2026-03-30T12:00:00.000Z"),
      },
    ];
    (
      prisma.careerEvent.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [];

    const [entry] = await buildGoalPlanEntries({
      goals: [{
        id: "goal-1",
        content: "I want to finish orientation paperwork and update my resume before I start applying for jobs.",
        status: "active",
      }],
      links: [],
    });

    assert.ok(entry);
    assert.ok(entry.recommendations.some((item) => item.resourceType === "form" && item.resourceId === "student-profile"));
    assert.ok(entry.recommendations.some((item) => item.resourceType === "orientation" && item.resourceId === "orientation-profile"));
    assert.ok(entry.recommendations.some((item) => item.resourceType === "portfolio_task"));
    assert.ok(entry.recommendations.some((item) => item.resourceType === "career_step" && item.resourceId === "opportunity:opp-1"));
  } finally {
    prisma.programDocument.findMany = originalProgramFindMany;
    prisma.orientationItem.findMany = originalOrientationFindMany;
    prisma.opportunity.findMany = originalOpportunityFindMany;
    prisma.careerEvent.findMany = originalEventFindMany;
  }
});

test("buildGoalPlanEntries recommends platforms, certifications, and guides for matched training goals", async () => {
  const originalProgramFindMany = prisma.programDocument.findMany;
  const originalOrientationFindMany = prisma.orientationItem.findMany;
  const originalOpportunityFindMany = prisma.opportunity.findMany;
  const originalEventFindMany = prisma.careerEvent.findMany;

  try {
    (
      prisma.programDocument.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [
      {
        id: "doc-quickbooks",
        title: "QuickBooks Study Guide",
        description: "Guide for the QuickBooks certification path",
        platformId: "gmetrix-and-learnkey",
        certificationId: "intuit-quickbooks",
      },
    ];
    (
      prisma.orientationItem.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [];
    (
      prisma.opportunity.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [];
    (
      prisma.careerEvent.findMany as unknown as (...args: unknown[]) => Promise<unknown[]>
    ) = async () => [
      {
        id: "event-1",
        title: "Accounting Career Fair",
        description: "Meet local employers in finance and bookkeeping.",
        location: "Student Union",
        startsAt: new Date("2026-03-25T14:00:00.000Z"),
      },
    ];

    const [entry] = await buildGoalPlanEntries({
      goals: [{
        id: "goal-2",
        content: "I want to build accounting skills and earn a QuickBooks certification.",
        status: "active",
      }],
      links: [],
    });

    assert.ok(entry);
    assert.ok(entry.recommendations.some((item) => item.resourceType === "platform" && item.resourceId === "gmetrix-and-learnkey"));
    assert.ok(entry.recommendations.some((item) => item.resourceType === "certification" && item.resourceId === "intuit-quickbooks"));
    assert.ok(entry.recommendations.some((item) => item.resourceType === "document" && item.resourceId === "doc-quickbooks"));
    assert.ok(entry.recommendations.some((item) => item.resourceType === "career_step" && item.resourceId === "event:event-1"));
  } finally {
    prisma.programDocument.findMany = originalProgramFindMany;
    prisma.orientationItem.findMany = originalOrientationFindMany;
    prisma.opportunity.findMany = originalOpportunityFindMany;
    prisma.careerEvent.findMany = originalEventFindMany;
  }
});
