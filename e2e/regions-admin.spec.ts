import { test, expect } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { E2E_TEACHER, type E2eUserFixture } from "./fixtures";
import { loginContext } from "./helpers/auth";
import { createPrisma } from "./helpers/db";

/**
 * E2E: an admin on a system with no regions sets one up and then creates a
 * class in it. This is the first-run path of the organization tree:
 *
 *   add a region -> place an instructor in it -> create a class in it
 *
 * The middle step is not optional. The class route refuses an instructor who
 * is not in the class's region ("Co-teachers must be in the same region."),
 * and it requires at least one instructor.
 *
 * Requires the fixture seed (idempotent, reruns are safe):
 *
 *   npx tsx scripts/seed-e2e-users.ts
 *
 * The seed creates no admin and no region. This spec makes its own marker
 * admin and instructor, and removes them and everything it creates when it
 * ends. They take the seeded teacher's password hash, so they sign in with
 * that fixture password and this file imports no app code.
 *
 * "A system with no regions" has to be true before the first step. On the
 * hermetic CI database it is. On a database that already has regions the spec
 * skips, because it must not delete anyone else's; in CI it fails instead, so
 * a seed that starts creating regions cannot quietly switch this test off.
 */

const ADMIN: E2eUserFixture = {
  login: "e2e-regions-admin",
  email: "e2e-regions-admin@test.local",
  displayName: "E2E Regions Admin",
  password: E2E_TEACHER.password,
};

const INSTRUCTOR = {
  login: "e2e-regions-instructor",
  email: "e2e-regions-instructor@test.local",
  displayName: "E2E Regions Instructor",
} as const;

const REGION = { name: "E2E North Region", code: "e2e-north-region" } as const;
const CLASS = { name: "E2E Regions Class", code: "e2e-regions-class" } as const;

const EMPTY_STATE = "No regions yet. Add your first region. You need one before you can create a class or invite staff.";

let prisma: PrismaClient;

/** Removes everything this spec creates. Class first, so no instructor row holds a user. */
async function removeMarkers(): Promise<void> {
  await prisma.spokesClass.deleteMany({ where: { code: CLASS.code } });
  await prisma.region.deleteMany({ where: { code: REGION.code } });
  await prisma.student.deleteMany({ where: { studentId: { in: [ADMIN.login, INSTRUCTOR.login] } } });
}

async function createMarkerUsers(): Promise<void> {
  const seeded = await prisma.student.findUnique({
    where: { studentId: E2E_TEACHER.login },
    select: { passwordHash: true },
  });
  if (!seeded) {
    throw new Error(`${E2E_TEACHER.login} not found. Run scripts/seed-e2e-users.ts`);
  }
  await prisma.student.create({
    data: {
      studentId: ADMIN.login,
      email: ADMIN.email,
      displayName: ADMIN.displayName,
      passwordHash: seeded.passwordHash,
      role: "admin",
    },
  });
  // No class and no region, so the admin page lists them under "Staff Waiting for a Region".
  await prisma.student.create({
    data: {
      studentId: INSTRUCTOR.login,
      email: INSTRUCTOR.email,
      displayName: INSTRUCTOR.displayName,
      passwordHash: seeded.passwordHash,
      role: "teacher",
    },
  });
}

test.beforeAll(async () => {
  prisma = createPrisma();
  await removeMarkers();

  const regionCount = await prisma.region.count();
  if (regionCount > 0 && process.env.CI) {
    throw new Error(`This spec needs a system with no regions, and found ${regionCount}.`);
  }
  test.skip(regionCount > 0, "Needs a system with no regions. It will not delete regions it did not create.");

  await createMarkerUsers();
});

test.afterAll(async () => {
  await removeMarkers();
  await prisma.$disconnect();
});

test("admin on a system with no regions adds a region, places an instructor, and creates a class in it", async ({ browser }) => {
  const context = await loginContext(browser, ADMIN);
  try {
    const page = await context.newPage();
    await page.goto("/admin");

    // A streamed segment briefly exists twice in the DOM; #main-content holds the one that stays.
    const main = page.locator("#main-content");
    const regionsCard = main.getByRole("region", { name: "Regions" });
    const createCard = main.locator(".surface-section").filter({ hasText: "Create a Class" });

    // 1. The empty state says what to do, and the class form has no region to pick yet.
    await expect(regionsCard.getByText(EMPTY_STATE)).toBeVisible({ timeout: 20_000 });
    await expect(createCard.getByLabel("Region").locator("option")).toHaveCount(1, { timeout: 20_000 });

    // 2. Add the first region. The short code follows the name.
    await regionsCard.getByLabel("Region name").fill(REGION.name);
    await expect(regionsCard.getByLabel("Short code")).toHaveValue(REGION.code);
    await regionsCard.getByRole("button", { name: "Add region" }).click();
    await expect(regionsCard.getByRole("status")).toHaveText(`${REGION.name} was added.`, { timeout: 20_000 });
    await expect(regionsCard.getByText(EMPTY_STATE)).toHaveCount(0);

    const regionsResponse = await context.request.get("/api/admin/regions");
    expect(regionsResponse.ok()).toBe(true);
    const { regions } = (await regionsResponse.json()) as { regions: Array<{ id: string; code: string }> };
    const region = regions.find((item) => item.code === REGION.code);
    expect(region, `${REGION.code} should be listed by the regions API`).toBeTruthy();
    const regionId = region!.id;
    await expect(page.locator(`#region-${regionId}`)).toContainText(REGION.name);

    // 3. The rest of the page picks the region up without a reload: place the instructor in it.
    const waitingRow = main.getByRole("listitem").filter({ hasText: INSTRUCTOR.displayName });
    await expect(waitingRow.getByLabel("Region")).toHaveValue(regionId, { timeout: 20_000 });
    await waitingRow.getByRole("button", { name: "Place in region" }).click();
    await expect(waitingRow).toHaveCount(0, { timeout: 20_000 });

    // 4. Create a class in the new region.
    await expect(createCard.getByLabel("Region").locator("option")).toHaveCount(2, { timeout: 20_000 });
    await createCard.getByLabel("Class name").fill(CLASS.name);
    await createCard.getByLabel("Class code").fill(CLASS.code);
    await createCard.getByLabel("Region").selectOption(regionId);
    await createCard.getByLabel(INSTRUCTOR.displayName).check();
    await createCard.getByRole("button", { name: "Create Class" }).click();
    await expect(main.getByText("Class created.")).toBeVisible({ timeout: 20_000 });

    // The class is in the region, with the instructor on it.
    const created = await prisma.spokesClass.findUnique({
      where: { code: CLASS.code },
      select: { regionId: true, instructors: { select: { instructor: { select: { studentId: true } } } } },
    });
    expect(created?.regionId).toBe(regionId);
    expect(created?.instructors.map((entry) => entry.instructor.studentId)).toEqual([INSTRUCTOR.login]);

    // 5. Class settings now has the region control the placement panel points at.
    const settingsRegion = main.locator("#class-settings-region");
    await expect(settingsRegion).toBeVisible({ timeout: 20_000 });
    await expect(settingsRegion).toHaveValue("");
    await expect(settingsRegion.locator("option")).toHaveText(["Keep the current region", REGION.name]);
  } finally {
    await context.close();
  }
});
