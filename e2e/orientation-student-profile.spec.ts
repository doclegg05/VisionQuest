import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { assertDisposableE2eDatabaseUrl } from "../src/lib/e2e-database-safety";

/**
 * E2E: a logged-in student completes the "Complete SPOKES Student Profile"
 * orientation step entirely in the browser — an HTML form, not a PDF iframe.
 * Submitting stores the answers on that student's SpokesRecord and marks the
 * matching OrientationItem complete.
 *
 * Self-sufficient: seeds its own demo student (never a real record) against
 * the explicitly injected E2E DATABASE_URL and cleans up after itself.
 * Requires the orientation items to be seeded first (`npm run db:seed`).
 */

const STUDENT_LOGIN = `e2e-orientation-profile-${randomBytes(8).toString("hex")}`;
const STUDENT_PASSWORD = "E2e-orientation-pass-1";
const PROFILE_ITEM_LABEL = "Complete SPOKES Student Profile";

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

function databaseUrlForE2e(): string {
  return assertDisposableE2eDatabaseUrl(
    process.env.DATABASE_URL,
    process.env.E2E_DATABASE_CONFIRMED_DISPOSABLE,
  );
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrlForE2e() });

let studentId: string;
let profileItemId: string;

test.beforeAll(async () => {
  const items = await prisma.orientationItem.findMany({
    select: { id: true, label: true },
  });
  if (items.length === 0) {
    throw new Error("OrientationItem table is empty — run `npm run db:seed` first.");
  }
  const profileItem = items.find((item) => item.label === PROFILE_ITEM_LABEL);
  if (!profileItem) {
    throw new Error(`Orientation item "${PROFILE_ITEM_LABEL}" is not seeded.`);
  }
  profileItemId = profileItem.id;

  const student = await prisma.student.create({
    data: {
      studentId: STUDENT_LOGIN,
      displayName: "E2E Orientation Student",
      passwordHash: hashPassword(STUDENT_PASSWORD),
      isActive: true,
    },
  });
  studentId = student.id;

  // The student layout forces /recovery-setup until all three security
  // questions exist — satisfy the gate with fixture rows (hashes are never
  // verified on this path, only presence).
  for (const questionKey of ["birth_city", "elementary_school", "favorite_teacher"]) {
    await prisma.securityQuestionAnswer.upsert({
      where: { studentId_questionKey: { studentId, questionKey } },
      update: {},
      create: { studentId, questionKey, answerHash: "e2e-fixture-not-a-real-hash" },
    });
  }

  // Reset leftovers from earlier runs, then pre-complete every step EXCEPT
  // the profile item so the wizard opens directly on the profile step.
  await prisma.orientationProgress.deleteMany({ where: { studentId } });
  await prisma.spokesRecord.deleteMany({ where: { studentId } });
  await prisma.orientationProgress.createMany({
    data: items
      .filter((item) => item.id !== profileItemId)
      .map((item) => ({
        studentId,
        itemId: item.id,
        completed: true,
        completedAt: new Date(),
      })),
  });
});

test.afterAll(async () => {
  if (studentId) {
    await prisma.orientationProgress.deleteMany({ where: { studentId } }).catch(() => {});
    await prisma.spokesRecord.deleteMany({ where: { studentId } }).catch(() => {});
  }
  if (studentId) {
    await prisma.student.delete({ where: { id: studentId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

test("student completes the Student Profile orientation step in the browser", async ({ page }) => {
  // Sign in from the landing page.
  await page.goto("/");
  await page.getByLabel(/username or email/i).fill(STUDENT_LOGIN);
  await page.getByLabel(/password/i).fill(STUDENT_PASSWORD);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/dashboard|welcome/, { timeout: 20_000 });

  // The orientation wizard opens on the Student Profile step as an HTML form.
  await page.goto("/orientation");
  await expect(
    page.getByRole("heading", { name: /spokes student profile/i }),
  ).toBeVisible({ timeout: 20_000 });
  // Explicitly NOT a PDF iframe.
  await expect(page.locator("iframe")).toHaveCount(0);

  // Fill the profile form in the browser.
  await page.getByLabel(/first name/i).fill("Evie");
  await page.getByLabel(/last name/i).fill("Testerson");
  await page.getByLabel(/date of birth/i).fill("1990-01-02");
  await page.getByLabel(/county/i).selectOption("Kanawha");
  await page.getByLabel(/highest education completed/i).selectOption("High school diploma");

  await page.getByRole("button", { name: /save & continue/i }).click();

  // The profile was the only pending item, so the wizard reaches completion.
  await expect(page.getByText(/orientation complete/i)).toBeVisible({ timeout: 20_000 });

  // The answers landed on the student's SpokesRecord…
  const record = await prisma.spokesRecord.findUnique({ where: { studentId } });
  expect(record?.firstName).toBe("Evie");
  expect(record?.lastName).toBe("Testerson");
  expect(record?.county).toBe("Kanawha");
  expect(record?.birthDate?.toISOString().slice(0, 10)).toBe("1990-01-02");
  expect(record?.educationalLevel).toBe("High school diploma");

  // …and the matching orientation item is marked complete.
  const progress = await prisma.orientationProgress.findUnique({
    where: { studentId_itemId: { studentId, itemId: profileItemId } },
  });
  expect(progress?.completed).toBe(true);
});
