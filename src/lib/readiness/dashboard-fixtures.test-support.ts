/**
 * The fixture student the dashboard measurements share: M1 (one cold render,
 * dashboard-query-count.test.tsx) and M2 (idle polling,
 * dashboard-idle-query-count.test.ts). One source, so the two metrics price
 * the same student. Branches this student takes are listed in the M1 header.
 */
import { createInitialState } from "@/lib/progression/engine";
import type { QueryFixtures } from "@/lib/query-counter.test-support";
import { SECURITY_QUESTIONS } from "@/lib/security-questions";

export const DASHBOARD_STUDENT_ID = "stu-readiness-001";
export const DASHBOARD_NOW = new Date("2026-11-10T15:00:00.000Z");
export const DASHBOARD_JWT_SECRET = "readiness-query-count-jwt-secret-for-tests-only";

const progressionState = JSON.stringify(createInitialState());

const taskRow = {
  id: "task-1", studentId: DASHBOARD_STUDENT_ID, createdById: "tch-1", appointmentId: null,
  title: "Finish your resume", description: null, status: "open", priority: "normal",
  dueAt: null, completedAt: null, createdAt: DASHBOARD_NOW, updatedAt: DASHBOARD_NOW,
};

export const DASHBOARD_FIXTURES: QueryFixtures = {
  // Session (admin client).
  "admin:sageConfirmationUse.findUnique": null,
  "admin:student.findUnique": {
    id: DASHBOARD_STUDENT_ID, studentId: "readiness-student", displayName: "Riley Fixture",
    role: "student", sessionVersion: 0, isActive: true, demoAccount: null,
  },
  // Layout and page.
  "goal.count": 2,
  "progression.findUnique": { state: progressionState },
  "orientationProgress.count": 3,
  "securityQuestionAnswer.findMany": SECURITY_QUESTIONS.map((question) => ({ questionKey: question.key })),
  // The Sage notice is acknowledged, so no redirect to /sage-notice (H6).
  "consentRecord.findFirst": { id: "consent-notice" },
  "notificationPreference.findUnique": null,
  "formSubmission.count": 1,
  // Readiness.
  "orientationItem.count": 8,
  "goal.findFirst": null,
  "certification.count": 0,
  "portfolioItem.count": 1,
  "resumeData.findUnique": { id: "resume-1" },
  "publicCredentialPage.findUnique": null,
  // Overview, activity, tasks.
  "certification.findMany": [{
    id: "cert-1", studentId: DASHBOARD_STUDENT_ID, certType: "ready-to-work", status: "in_progress",
    verificationStatus: null,
    requirements: [{ id: "req-1", templateId: "tpl-1", completed: true, verifiedBy: null }],
  }],
  "certTemplate.findMany": [{ id: "tpl-1", certType: "ready-to-work", required: true, needsFile: false, needsVerify: true }],
  "studentClassEnrollment.findFirst": { class: { requirements: [{ status: "required" }] } },
  "application.count": 1,
  "formSubmission.findFirst": { status: "approved" },
  "studentTask.findMany": [taskRow],
  "studentTask.count": 1,
  // Support and next step.
  "careerDiscovery.findUnique": { status: "complete" },
  "message.count": 6,
  "studentSavedJob.count": 1,
  "studentAlert.count": 1,
  "appointment.findFirst": { id: "appt-1", title: "Advising check-in", startsAt: DASHBOARD_NOW, locationLabel: "Room 2" },
  "orientationItem.findMany": [{ id: "item-1", label: "Sign the attendance policy" }],
  "sagePanel.findFirst": null,
  "moodEntry.findFirst": null,
};
