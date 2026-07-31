import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { loadStudentAlertSyncContext } from "@/lib/advising-sync-context";

// "server-only" throws at import time outside a Next.js server build.
mock.module("server-only", { namedExports: {} });

// advising-sync imports prisma for applyStudentAlertSyncPlan; the plan builder
// under test is pure, so an empty stub is enough.
mock.module("@/lib/db", {
  namedExports: { prisma: {} },
});

type SyncContext = Awaited<ReturnType<typeof loadStudentAlertSyncContext>>;
type SyncCertification = NonNullable<SyncContext["studentSignals"]>["certifications"][number];
type SyncGoalResourceLink = NonNullable<SyncContext["studentSignals"]>["goalResourceLinks"][number];

let sync: typeof import("@/lib/advising-sync");

before(async () => {
  sync = await import("@/lib/advising-sync");
});

const NOW = new Date("2026-07-01T12:00:00.000Z");
const ENROLLED_AT = new Date("2026-05-01T12:00:00.000Z");

const readyToWorkCert: SyncCertification = {
  certType: "ready-to-work",
  status: "in_progress",
  startedAt: new Date("2026-06-01T12:00:00.000Z"),
  completedAt: null,
  verificationStatus: "self_reported",
  requirements: [
    {
      templateId: "tpl-1",
      completed: false,
      completedAt: null,
      verifiedAt: null,
      verifiedBy: null,
      template: { required: true },
    },
  ],
};

// Decoy listed FIRST: if the plan grabbed certifications[0] instead of finding
// by certType, this completed + verified cert would suppress both alerts below.
const decoyCert: SyncCertification = {
  certType: "ic3",
  status: "completed",
  startedAt: new Date("2026-06-20T12:00:00.000Z"),
  completedAt: new Date("2026-06-25T12:00:00.000Z"),
  verificationStatus: "verified",
  requirements: [],
};

const certificationLink: SyncGoalResourceLink = {
  id: "link-1",
  goalId: "goal-1",
  resourceType: "certification",
  resourceId: "ic3",
  title: "IC3 Digital Literacy",
  description: null,
  url: null,
  linkType: "assigned",
  status: "assigned",
  dueAt: null,
  notes: null,
  assignedById: "teacher-1",
  createdAt: new Date("2026-06-28T12:00:00.000Z"),
  updatedAt: new Date("2026-06-28T12:00:00.000Z"),
};

function makeContext(certifications: SyncCertification[]): SyncContext {
  return {
    tasks: [],
    appointments: [],
    studentSignals: {
      id: "student-1",
      studentId: "VQ-0001",
      displayName: "Test Student",
      email: "student@example.com",
      createdAt: ENROLLED_AT,
      progression: null,
      conversations: [],
      goals: [
        {
          id: "goal-1",
          level: "monthly",
          content: "Earn the IC3 credential.",
          status: "active",
          sourceMessageId: null,
          createdAt: new Date("2026-06-28T12:00:00.000Z"),
          updatedAt: new Date("2026-06-30T12:00:00.000Z"),
          lastReviewedAt: new Date("2026-06-30T12:00:00.000Z"),
          confirmedAt: null,
        },
      ],
      goalResourceLinks: [certificationLink],
      formSubmissions: [],
      orientationProgress: [],
      portfolioItems: [],
      resumeData: null,
      publicCredentialPage: null,
      spokesRecord: null,
      classEnrollments: [],
      files: [],
      appointments: [],
      assignedTasks: [],
      eventRegistrations: [],
      applications: [],
      certifications,
      _count: { applications: 0, eventRegistrations: 0 },
    },
    orientationItems: [],
    existing: [],
    recentMoodEntries: [],
    compliance: null,
    placementBridgeScope: { mode: "off" },
  };
}

describe("buildStudentAlertSyncPlan certification selection", () => {
  it("selects the ready-to-work certification from a mixed list", () => {
    const plan = sync.buildStudentAlertSyncPlan({
      studentId: "student-1",
      now: NOW,
      context: makeContext([decoyCert, readyToWorkCert]),
    });

    const alertTypes = plan.desiredAlerts.map((alert) => alert.type);
    // Both alerts are driven by the ready-to-work cert (stalled 30 days,
    // self-reported and unverified) — the decoy would produce neither.
    assert.ok(alertTypes.includes("certification_stalled"));
    assert.ok(alertTypes.includes("certification_unverified"));

    // The full mixed list still reaches goal evidence: the ic3 link matches
    // the ic3 cert row, not whichever cert happens to be first.
    const [evidence] = plan.goalEvidenceEntries;
    assert.ok(evidence);
    assert.equal(evidence.resourceId, "ic3");
    assert.equal(evidence.evidenceStatus, "approved");
  });

  it("raises no certification alerts when no ready-to-work certification exists", () => {
    const staleDecoy: SyncCertification = {
      ...decoyCert,
      status: "in_progress",
      completedAt: null,
      verificationStatus: "self_reported",
    };

    const plan = sync.buildStudentAlertSyncPlan({
      studentId: "student-1",
      now: NOW,
      context: makeContext([staleDecoy]),
    });

    const alertTypes = plan.desiredAlerts.map((alert) => alert.type);
    assert.ok(!alertTypes.includes("certification_stalled"));
    assert.ok(!alertTypes.includes("certification_unverified"));
  });
});
