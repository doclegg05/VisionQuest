import assert from "node:assert/strict";
import { before, it, mock } from "node:test";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";

let education: { status: string } | null = null;
let failApplications = false;
const certType = CERTIFICATIONS[0].id;
mock.module("@/lib/db", { namedExports: { prisma: {
  certification: { findMany: async () => [
    { certType, status: "completed", verificationStatus: null, requirements: [] },
    { certType: "unapproved-import", status: "completed", verificationStatus: "verified", requirements: [] },
    { certType: "ready-to-work", status: "in_progress", verificationStatus: "self_reported", requirements: [{ templateId: "template", completed: true, verifiedBy: null, fileId: null }] },
  ] },
  certTemplate: { findMany: async () => [{ id: "template", required: true, needsVerify: true, needsFile: false }] },
  studentClassEnrollment: { findFirst: async () => ({ class: { requirements: [{ status: "optional" }] } }) },
  application: { count: async () => { if (failApplications) throw new Error("offline"); return 2; } },
  resumeData: { findUnique: async () => null },
  formSubmission: { findFirst: async () => education },
  goal: { count: async () => 1 },
} } });
let readers: typeof import("./readers");
before(async () => { readers = await import("./readers"); });
it("uses approved recorded certifications, separates completion from provenance, and preserves review rules", async () => {
  const result = await readers.readOverview("student");
  const learning = result.outcomes[0];
  assert.match(learning.detail, /0 verified/); assert.match(learning.detail, /1 completed with no verification record/);
  const ready = result.outcomes[1];
  assert.equal(ready.value, "0 of 1 requirements satisfied");
  assert.match(ready.detail, /optional/); assert.match(ready.detail, /1 awaiting instructor review/);
  assert.equal(result.outcomes[2].value, "2 applications recorded");
  assert.match(result.outcomes[2].detail, /No resume/);
});
it("does not infer education from AI text, platform visits, XP or task completion", async () => {
  const result = await readers.readOverview("student");
  assert.equal(result.outcomes[3].value, "No education plan on file");
  education = { status: "pending" };
  try {
    const recorded = await readers.readOverview("student");
    assert.equal(recorded.outcomes[3].value, "Education & career plan on file");
    assert.match(recorded.outcomes[3].detail, /pending.*not evidence of postsecondary/);
  } finally { education = null; }
});
it("propagates unavailable records instead of reporting zero", async () => {
  failApplications = true;
  try { await assert.rejects(readers.readOverview("student"), /offline/); }
  finally { failApplications = false; }
});
it("charts current tasks across all statuses and excludes unknown dates and reopened tasks from completions", () => {
  const data = readers.summarizeActivity([
    { status: "completed", completedAt: new Date("2026-09-10T00:00:00Z") },
    { status: "completed", completedAt: null },
    { status: "completed", completedAt: new Date("2025-01-01T00:00:00Z") },
    { status: "open", completedAt: new Date("2026-09-10T00:00:00Z") },
    { status: "legacy", completedAt: null },
  ], new Date("2026-09-10T12:00:00Z"));
  assert.equal(data.completions.length, 30); assert.equal(data.completions.at(-1)?.count, 1);
  assert.equal(data.unknownCompletionDates, 1);
  assert.equal(data.statuses.find((s) => s.status === "completed")?.count, 3);
  assert.equal(data.statuses.find((s) => s.status === "legacy")?.count, 1);
});
