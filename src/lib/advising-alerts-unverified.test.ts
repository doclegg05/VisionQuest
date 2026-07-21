import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildStudentAlertDescriptors } from "./advising-alerts";

// P1-4: certification_unverified — self-reported certification progress that
// no instructor has verified for 7+ days.

const NOW = new Date("2026-07-20T17:00:00.000Z");

function alertsFor(certification: {
  status: string;
  startedAt: Date | null;
  lastProgressAt: Date | null;
  completedRequiredCount: number;
  requiredCount: number;
  verificationStatus?: string | null;
}) {
  return buildStudentAlertDescriptors({
    now: NOW,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-1",
      // Recent activity so inactivity/orientation alerts stay quiet.
      studentCreatedAt: new Date("2026-07-19T12:00:00.000Z"),
      lastActivityAt: new Date("2026-07-20T12:00:00.000Z"),
      applicationCount: 1,
      eventRegistrationCount: 1,
      orientationComplete: true,
      birthDate: new Date("2000-05-12T00:00:00.000Z"),
      certification,
    },
  }).filter((alert) => alert.type === "certification_unverified");
}

describe("certification_unverified alert", () => {
  it("fires at medium severity once a self-reported cert sits unverified for 7+ days", () => {
    const alerts = alertsFor({
      status: "completed",
      startedAt: new Date("2026-06-01T12:00:00.000Z"),
      lastProgressAt: new Date("2026-07-12T12:00:00.000Z"), // 8 days ago
      completedRequiredCount: 3,
      requiredCount: 3,
      verificationStatus: "self_reported",
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.alertKey, "certification_unverified:student-1");
    assert.equal(alerts[0]?.severity, "medium");
    assert.equal(alerts[0]?.sourceType, "certification");
    assert.equal(alerts[0]?.sourceId, "student-1");
  });

  it("stays quiet inside the 7-day window", () => {
    const alerts = alertsFor({
      status: "completed",
      startedAt: new Date("2026-07-01T12:00:00.000Z"),
      lastProgressAt: new Date("2026-07-15T12:00:00.000Z"), // 5 days ago
      completedRequiredCount: 3,
      requiredCount: 3,
      verificationStatus: "self_reported",
    });

    assert.equal(alerts.length, 0);
  });

  it("does not fire once the instructor has verified the outcome", () => {
    const alerts = alertsFor({
      status: "completed",
      startedAt: new Date("2026-05-01T12:00:00.000Z"),
      lastProgressAt: new Date("2026-06-01T12:00:00.000Z"),
      completedRequiredCount: 3,
      requiredCount: 3,
      verificationStatus: "verified",
    });

    assert.equal(alerts.length, 0);
  });

  it("does not fire for legacy rows with no verification status", () => {
    const alerts = alertsFor({
      status: "completed",
      startedAt: new Date("2026-05-01T12:00:00.000Z"),
      lastProgressAt: new Date("2026-06-01T12:00:00.000Z"),
      completedRequiredCount: 3,
      requiredCount: 3,
      verificationStatus: null,
    });

    assert.equal(alerts.length, 0);
  });

  it("still fires for partially complete certs whose progress is self-reported", () => {
    const alerts = alertsFor({
      status: "in_progress",
      startedAt: new Date("2026-06-01T12:00:00.000Z"),
      lastProgressAt: new Date("2026-07-01T12:00:00.000Z"),
      completedRequiredCount: 1,
      requiredCount: 3,
      verificationStatus: "self_reported",
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.type, "certification_unverified");
  });
});
