import { createHash, randomBytes } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth";
import { generatePassword } from "../src/lib/password-policy";
import { SECURITY_QUESTIONS } from "../src/lib/security-questions";
import { SAGE_NOTICE_ACK_BUTTON } from "../src/lib/about-sage/notice";
import { WELCOME_COMPLETE_EVENT } from "../src/lib/progression/welcome-routing";
import { E2E_CLASS } from "./fixtures";
import { createPrisma } from "./helpers/db";

/**
 * E2E (readiness task T6): a student's first day, through every gate.
 *
 * An instructor creates a student with a temporary password. On the first
 * sign-in that student meets, in this order:
 *   1. the forced password change (src/proxy.ts holds a session whose token
 *      carries `mustChangePassword` on /change-password),
 *   2. the Sage notice (the student layout sends anyone without an
 *      acknowledgement of SAGE_NOTICE_VERSION to /sage-notice),
 *   3. the recovery questions (the same layout sends anyone with fewer than
 *      three answers to /recovery-setup),
 * and only then reaches the dashboard and Sage chat. Every other spec seeds
 * past these gates; this one seeds none of them. The fixture student gets no
 * ConsentRecord and no SecurityQuestionAnswer rows, so each gate must fire.
 *
 * One thing IS seeded: the welcome-flow completion fact. It is not one of the
 * three gates, and without it the dashboard sends a brand-new student to the
 * /welcome tour, which student-journey.spec.ts already covers.
 *
 * src/lib/readiness/first-day-journey.test.ts reads this file and pins the
 * order of the URL expectations below and the absence of gate rows in the
 * fixture. Keep `atPath("…")` and `signIn(page, login, <password>)` in the
 * shape it reads.
 *
 * Sign-in budget: /api/auth/login allows 5 attempts per account per 15
 * minutes. This walk signs one fresh account in twice. A CI retry gets a
 * fresh account of its own, because beforeAll runs again in the new worker.
 */

const SESSION_COOKIE = "vq-session";
/** Logout revokes a token under this key (src/lib/session-revocation.ts). */
const REVOCATION_KEY_PREFIX = "session-revoked:";
const GATE_PATHS = ["/change-password", "/sage-notice", "/recovery-setup"] as const;
const NAV_TIMEOUT_MS = 30_000;

let prisma: PrismaClient | undefined;
let studentDbId: string | undefined;
const login = `e2e-first-day-${randomBytes(4).toString("hex")}`;
const temporaryPassword = generatePassword();
const newPassword = `${generatePassword()}-mine`;
const revokedTokenKeys: string[] = [];

/** Matches a URL whose path is exactly `pathname`, with any query string. */
function atPath(pathname: string): RegExp {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^https?://[^/]+${escaped}(\\?.*)?$`);
}

/** Matches `text` literally. */
function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

async function signIn(page: Page, account: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/username or email/i).fill(account);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in to see what to do today/i }).click();
}

/** A mutation proof counts only the expected missing gate and next page, never an infrastructure failure. */
function gateMismatch(page: Page, gate: string, cause: unknown): Error {
  return new Error(`FIRST_DAY_GATE_MISSING:${gate}:ACTUAL:${new URL(page.url()).pathname}`, { cause });
}

/** The key logout stored for this context's current session token, for afterAll to delete. */
async function rememberRevocationKey(context: BrowserContext): Promise<void> {
  const cookie = (await context.cookies()).find((candidate) => candidate.name === SESSION_COOKIE);
  if (!cookie) return;
  revokedTokenKeys.push(`${REVOCATION_KEY_PREFIX}${createHash("sha256").update(cookie.value).digest("hex")}`);
}

/**
 * Every path the main frame lands on from now on: each page load's final URL
 * and each client-side route change. It does not see the hops inside one HTTP
 * redirect chain; the final URL expectation covers where the walk ends.
 */
function recordPaths(page: Page): string[] {
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });
  return visited;
}

async function createFirstDayStudent(client: PrismaClient): Promise<string> {
  const spokesClass = await client.spokesClass.findUnique({ where: { code: E2E_CLASS.code }, select: { id: true } });
  if (!spokesClass) throw new Error(`The e2e class ${E2E_CLASS.code} is missing. Run scripts/seed-e2e-users.ts first.`);

  // What an instructor's "create student" does: an active account with a
  // generated password the instructor knows, so the student must change it.
  const created = await client.student.create({
    data: {
      studentId: login,
      displayName: "E2E First Day Student",
      passwordHash: (await hashPassword(temporaryPassword)).hash,
      role: "student",
      isActive: true,
      mustChangePassword: true,
    },
    select: { id: true },
  });
  await client.studentClassEnrollment.create({ data: { classId: spokesClass.id, studentId: created.id } });
  // Not a gate: keeps /dashboard from sending a new student into the /welcome tour.
  await client.progressionEvent.create({
    data: {
      studentId: created.id,
      eventType: WELCOME_COMPLETE_EVENT.eventType,
      sourceType: WELCOME_COMPLETE_EVENT.sourceType,
      sourceId: WELCOME_COMPLETE_EVENT.sourceId,
      xp: WELCOME_COMPLETE_EVENT.xp,
    },
  });
  return created.id;
}

async function deleteFirstDayStudent(client: PrismaClient, id: string | undefined): Promise<void> {
  if (id) {
    await client.consentRecord.deleteMany({ where: { studentId: id } });
    await client.securityQuestionAnswer.deleteMany({ where: { studentId: id } });
    await client.auditLog.deleteMany({ where: { OR: [{ actorId: id }, { targetId: id }] } });
  }
  if (revokedTokenKeys.length > 0) {
    await client.sageConfirmationUse.deleteMany({ where: { tokenHash: { in: revokedTokenKeys } } });
  }
  // Cascades remove the enrollment, Progression, ProgressionEvent and any other child row.
  await client.student.deleteMany({ where: { studentId: login } });
}

test.beforeAll(async () => {
  prisma = createPrisma();
  studentDbId = await createFirstDayStudent(prisma);
});

test.afterAll(async () => {
  if (!prisma) return;
  try {
    await deleteFirstDayStudent(prisma, studentDbId);
  } finally {
    await prisma.$disconnect();
  }
});

async function changeTemporaryPassword(page: Page): Promise<void> {
  const main = page.locator("#main-content");
  await expect(main.getByRole("heading", { name: "Choose a New Password" })).toBeVisible();
  await main.getByLabel("Password your instructor gave you", { exact: true }).fill(temporaryPassword);
  await main.getByLabel("New password", { exact: true }).fill(newPassword);
  await main.getByRole("button", { name: "Save new password" }).click();
  await expect(main.getByText("Your new password is saved.")).toBeVisible({ timeout: NAV_TIMEOUT_MS });
  await main.getByRole("button", { name: "Continue" }).click();
}

async function answerRecoveryQuestions(page: Page): Promise<void> {
  const main = page.locator("#main-content");
  for (const [index, question] of SECURITY_QUESTIONS.entries()) {
    await main.getByLabel(literal(question.prompt)).fill(`first day answer ${index + 1}`);
  }
  await main.getByRole("button", { name: "Save and continue" }).click();
}

test("a new student passes the password, Sage notice and recovery gates, then reaches chat", async ({ page }) => {
  // A deliberately missing gate must reach the URL assertion's own failure,
  // rather than being interrupted by Playwright's default 30-second test limit.
  test.setTimeout(120_000);
  const main = page.locator("#main-content");

  await test.step("first sign-in is held on the password change", async () => {
    await signIn(page, login, temporaryPassword);
    await expect(page).toHaveURL(atPath("/change-password"), { timeout: NAV_TIMEOUT_MS }).catch((error) => { throw gateMismatch(page, "/change-password", error); });
    await changeTemporaryPassword(page);
  });

  await test.step("then the Sage notice", async () => {
    await expect(page).toHaveURL(atPath("/sage-notice"), { timeout: NAV_TIMEOUT_MS }).catch((error) => { throw gateMismatch(page, "/sage-notice", error); });
    await main.getByRole("button", { name: SAGE_NOTICE_ACK_BUTTON }).click();
  });

  await test.step("then the recovery questions", async () => {
    await expect(page).toHaveURL(atPath("/recovery-setup"), { timeout: NAV_TIMEOUT_MS }).catch((error) => { throw gateMismatch(page, "/recovery-setup", error); });
    await answerRecoveryQuestions(page);
  });

  await test.step("then the dashboard and Sage chat", async () => {
    await expect(page).toHaveURL(atPath("/dashboard"), { timeout: NAV_TIMEOUT_MS });
    await expect(main.getByRole("heading", { name: "Your Dashboard" })).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await main.getByRole("link", { name: "Talk to Sage", exact: true }).click();
    await expect(page).toHaveURL(atPath("/chat"), { timeout: NAV_TIMEOUT_MS });
    // No message is sent: CI has no model.
    await expect(main.getByLabel("Message to Sage")).toBeVisible({ timeout: NAV_TIMEOUT_MS });
  });

  await test.step("the gates wrote what they ask for", async () => {
    if (!prisma || !studentDbId) throw new Error("beforeAll did not create the student");
    const row = await prisma.student.findUniqueOrThrow({ where: { id: studentDbId }, select: { mustChangePassword: true } });
    expect(row.mustChangePassword).toBe(false);
    expect(await prisma.consentRecord.count({ where: { studentId: studentDbId, revokedAt: null } })).toBeGreaterThan(0);
    expect(await prisma.securityQuestionAnswer.count({ where: { studentId: studentDbId } })).toBe(SECURITY_QUESTIONS.length);
  });

  await test.step("sign out", async () => {
    await rememberRevocationKey(page.context());
    await page.getByRole("button", { name: "Log out" }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(atPath("/"), { timeout: NAV_TIMEOUT_MS });
  });

  await test.step("the second sign-in, with the new password, meets no gate", async () => {
    const visited = recordPaths(page);
    await signIn(page, login, newPassword);
    await expect(page).toHaveURL(atPath("/dashboard"), { timeout: NAV_TIMEOUT_MS });
    await expect(main.getByRole("heading", { name: "Your Dashboard" })).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    expect(visited.filter((visitedPath) => GATE_PATHS.some((gate) => gate === visitedPath))).toEqual([]);
  });
});
