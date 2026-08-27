import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * E2E: Phase 0A placement bridge, full loop.
 *
 * A student's application is accepted (self-reported). The teacher verifies
 * the outcome, which raises exactly one "Record employment outcome" queue
 * item. The teacher opens the student's SPOKES workspace, uses the verified-
 * application prefill, saves — and the placement lands on the SpokesRecord
 * with application provenance while the queue item auto-resolves.
 *
 * Self-sufficient: seeds its own demo teacher/student/opportunity (never real
 * records) against the DATABASE_URL in .env.local, turns the pilot flag on
 * for the run, and cleans up after itself — including restoring the previous
 * placement_bridge_classes value.
 */

const TEACHER_LOGIN = "e2e-placement-teacher";
const TEACHER_PASSWORD = "E2e-placement-teach-1";
const STUDENT_LOGIN = "e2e-placement-student";
const FLAG_KEY = "placement_bridge_classes";

// Mirrors hashPassword() in src/lib/auth.ts (format scrypt$<salt>$<hash>,
// N=2^15, r=8, p=1, keylen=64). Duplicated because auth.ts imports
// next/headers and cannot load outside the Next runtime; the params are
// pinned by auth.test.ts, and drift there surfaces here as a failed login.
function hashPassword(password: string): string {
  const salt = randomBytes(32).toString("hex");
  const derived = scryptSync(password, salt, 64, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function databaseUrlFromEnvLocal(): string {
  const envPath = path.join(__dirname, "..", ".env.local");
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env.local");
  // dotenv-style values may be quoted ("..." or '...'); the quotes are not
  // part of the URL.
  const raw = line.slice("DATABASE_URL=".length).trim();
  const quoted = raw.match(/^(["'])(.*)\1$/);
  return quoted ? quoted[2] : raw;
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrlFromEnvLocal() });

let teacherId: string;
let studentId: string;
let opportunityId: string;
let applicationId: string;
let previousFlag: { value: string; updatedBy: string | null } | null = null;

test.beforeAll(async () => {
  const teacher = await prisma.student.upsert({
    where: { studentId: TEACHER_LOGIN },
    update: { passwordHash: hashPassword(TEACHER_PASSWORD), isActive: true, role: "teacher" },
    create: {
      studentId: TEACHER_LOGIN,
      displayName: "E2E Placement Teacher",
      passwordHash: hashPassword(TEACHER_PASSWORD),
      role: "teacher",
    },
  });
  teacherId = teacher.id;

  const student = await prisma.student.upsert({
    where: { studentId: STUDENT_LOGIN },
    update: { isActive: true },
    create: {
      studentId: STUDENT_LOGIN,
      displayName: "E2E Placement Student",
      passwordHash: hashPassword("E2e-placement-stud-1"),
    },
  });
  studentId = student.id;

  const opportunity = await prisma.opportunity.create({
    data: {
      title: "E2E Line Cook",
      company: "E2E Mountain Diner",
      type: "job",
      createdById: teacherId,
    },
  });
  opportunityId = opportunity.id;

  // Student-side state: accepted, still self-reported. The teacher's verify
  // action inside the test is what should raise the queue item.
  const application = await prisma.application.upsert({
    where: { studentId_opportunityId: { studentId, opportunityId } },
    update: { status: "accepted", verificationStatus: "self_reported" },
    create: {
      studentId,
      opportunityId,
      status: "accepted",
      appliedAt: new Date(),
      verificationStatus: "self_reported",
    },
  });
  applicationId = application.id;

  // Clean slate for re-runs.
  await prisma.studentAlert.deleteMany({
    where: { alertKey: `placement_outcome:${applicationId}` },
  });
  await prisma.spokesRecord.deleteMany({ where: { studentId } });

  // Pilot flag ON for the run (plain, unencrypted value) — remember the full
  // previous row (value AND updatedBy, since the e2e teacher is deleted in
  // afterAll) so cleanup can restore it exactly.
  const existingFlag = await prisma.systemConfig.findUnique({ where: { key: FLAG_KEY } });
  previousFlag = existingFlag
    ? { value: existingFlag.value, updatedBy: existingFlag.updatedBy }
    : null;
  await prisma.systemConfig.upsert({
    where: { key: FLAG_KEY },
    update: { value: "all", updatedBy: teacherId },
    create: { key: FLAG_KEY, value: "all", updatedBy: teacherId },
  });
});

test.afterAll(async () => {
  // Restore the flag row exactly as it was before the run (or remove it if
  // it did not exist) so the pilot scope never stays "all" after the suite.
  if (previousFlag) {
    await prisma.systemConfig
      .update({
        where: { key: FLAG_KEY },
        data: { value: previousFlag.value, updatedBy: previousFlag.updatedBy },
      })
      .catch(() => {});
  } else {
    await prisma.systemConfig.deleteMany({ where: { key: FLAG_KEY } }).catch(() => {});
  }
  if (studentId) {
    await prisma.studentAlert.deleteMany({ where: { studentId } }).catch(() => {});
    await prisma.spokesRecord.deleteMany({ where: { studentId } }).catch(() => {});
    await prisma.application.deleteMany({ where: { studentId } }).catch(() => {});
  }
  if (opportunityId) {
    await prisma.opportunity.deleteMany({ where: { id: opportunityId } }).catch(() => {});
  }
  await prisma.student.deleteMany({
    where: { studentId: { in: [STUDENT_LOGIN, TEACHER_LOGIN] } },
  }).catch(() => {});
  await prisma.$disconnect();
});

test("verify → queue item → prefilled SPOKES save → provenance + resolved item", async ({ page, baseURL }) => {
  // Teacher signs in from the landing page.
  await page.goto("/");
  await page.getByLabel(/username or email/i).fill(TEACHER_LOGIN);
  await page.getByLabel(/password/i).fill(TEACHER_PASSWORD);
  await page.getByRole("button", { name: /sign in to see what to do today/i }).click();
  await page.waitForURL(/teacher/, { timeout: 20_000 });

  // Verify the self-reported accepted outcome (same endpoint the Progress
  // tab's verify button calls). Origin header satisfies CSRF validation.
  const verifyResponse = await page.request.post("/api/teacher/outcomes/verify", {
    data: { targetType: "application", targetId: applicationId },
    headers: { Origin: baseURL ?? "" },
  });
  expect(verifyResponse.ok()).toBe(true);

  // Verification alone must raise exactly one open queue item.
  const alerts = await prisma.studentAlert.findMany({
    where: { studentId, type: "placement_outcome_pending" },
  });
  expect(alerts).toHaveLength(1);
  expect(alerts[0].status).toBe("open");
  expect(alerts[0].alertKey).toBe(`placement_outcome:${applicationId}`);
  expect(alerts[0].sourceId).toBe(applicationId);

  // Open the SPOKES workspace — the verified application appears as a
  // prefill suggestion.
  await page.goto(`/teacher/students/${studentId}/spokes`);
  await expect(page.getByText(/verified job outcome ready to record/i)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /use this job/i }).click();

  // The employer field is prefilled from the application's opportunity —
  // but the start date is NOT. Verification time is not the employment
  // start date; fabricating one would corrupt grant and follow-up data.
  await expect(page.getByPlaceholder("Employer name")).toHaveValue("E2E Mountain Diner");
  await expect(page.getByLabel(/employment start date/i)).toHaveValue("");

  // Saving the link without a start date is refused by the route.
  await page.getByRole("button", { name: /save record/i }).click();
  await expect(
    page.getByText(/record the employment start date to link this application/i),
  ).toBeVisible({ timeout: 20_000 });
  const unrecorded = await prisma.spokesRecord.findUnique({ where: { studentId } });
  expect(unrecorded?.placementApplicationId ?? null).toBeNull();

  // Staff enter the actual first day of work, then save.
  await page.getByLabel(/employment start date/i).fill("2026-07-15");
  await page.getByRole("button", { name: /save record/i }).click();
  await expect(page.getByText(/spokes record saved/i)).toBeVisible({ timeout: 20_000 });

  // Placement landed with application provenance and the exact staff-entered
  // start date…
  const record = await prisma.spokesRecord.findUnique({ where: { studentId } });
  expect(record?.placementApplicationId).toBe(applicationId);
  expect(record?.employerName).toBe("E2E Mountain Diner");
  expect(record?.unsubsidizedEmploymentAt?.toISOString().slice(0, 10)).toBe("2026-07-15");

  // …and the queue item auto-resolved on the post-save sync.
  const afterSave = await prisma.studentAlert.findUnique({
    where: { alertKey: `placement_outcome:${applicationId}` },
  });
  expect(afterSave?.status).toBe("resolved");

  // The workspace now shows the linked confirmation instead of the banner.
  await page.reload();
  await expect(
    page.getByText(/linked to a verified accepted application/i),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/verified job outcome ready to record/i)).toHaveCount(0);
});
