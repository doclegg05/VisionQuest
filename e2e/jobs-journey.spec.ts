import { test, expect, type BrowserContext } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { E2E_STUDENT, E2E_CLASS } from "./fixtures";
import { loginContext } from "./helpers/auth";
import { createPrisma } from "./helpers/db";

test.describe("Student job-search journey", () => {
  test.describe.configure({ mode: "serial" });
  let prisma: PrismaClient;
  let context: BrowserContext;
  let listingId: string;

  test.beforeAll(async ({ browser }) => {
    prisma = createPrisma();
    const cohort = await prisma.spokesClass.findUniqueOrThrow({ where: { code: E2E_CLASS.code } });
    const config = await prisma.jobClassConfig.upsert({
      where: { classId: cohort.id },
      create: { classId: cohort.id, region: "Summersville, WV", sources: ["wvumedicine", "localemployers"] },
      update: { region: "Summersville, WV", sources: ["wvumedicine", "localemployers"] },
    });
    const listing = await prisma.jobListing.upsert({
      where: { classConfigId_source_sourceId: { classConfigId: config.id, source: "wvumedicine", sourceId: "e2e-job-journey" } },
      create: {
        classConfigId: config.id, source: "wvumedicine", sourceId: "e2e-job-journey", sourceType: "api",
        title: "E2E Housekeeping Aide", company: "E2E Employer", location: "Summersville, WV", workMode: "onsite",
        description: "Synthetic test listing. Clean common areas and follow safety procedures.",
        url: "https://example.com/e2e-jobs", scrapeBatchId: "e2e-job-journey", status: "active",
      },
      update: { status: "active" },
    });
    listingId = listing.id;
    await prisma.studentSavedJob.deleteMany({ where: { jobListingId: listingId } });
    context = await loginContext(browser, E2E_STUDENT);
  });

  test.afterAll(async () => {
    await context?.close();
    if (prisma && listingId) {
      await prisma.studentSavedJob.deleteMany({ where: { jobListingId: listingId } });
      await prisma.jobListing.delete({ where: { id: listingId } });
    }
    await prisma?.$disconnect();
  });

  test("searches, saves, marks applied, and retains notes and status after a page reload", async () => {
    const page = await context.newPage();
    await page.goto("/career#jobs");
    await page.getByLabel("Search jobs by title, company, or keyword").fill("E2E");
    // A heading's card contains the actions; scope to its nearest card root.
    const listing = page.getByRole("heading", { name: "E2E Housekeeping Aide", exact: true }).locator("xpath=ancestor::div[contains(@class, 'surface-section')][1]");
    await expect(listing).toBeVisible();
    await listing.getByRole("button", { name: "Save", exact: true }).click();
    await expect(listing.getByLabel("Application status")).toBeVisible();
    await listing.getByLabel("Application status").selectOption("applied");
    await listing.getByLabel("Application notes").fill("Follow up with the employer on Monday.");
    await listing.getByRole("button", { name: "Update", exact: true }).click();
    await expect(listing.getByRole("button", { name: "Applied", exact: true })).toBeVisible();
    await page.reload();
    await page.getByLabel("Search jobs by title, company, or keyword").fill("E2E");
    await expect(listing.getByLabel("Application status")).toHaveValue("applied");
    await expect(listing.getByLabel("Application notes")).toHaveValue("Follow up with the employer on Monday.");
    const saved = await prisma.studentSavedJob.findFirstOrThrow({ where: { jobListingId: listingId } });
    expect(saved.status).toBe("applied");
    expect(saved.appliedAt).not.toBeNull();
    await page.close();
  });

  test("shows a failed search and successfully retries without stale results", async () => {
    const page = await context.newPage();
    await page.route("**/api/jobs?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
    await page.goto("/career#jobs");
    await expect(page.getByRole("alert").filter({ hasText: "We could not load jobs" })).toBeVisible();
    await expect(page.getByText("Loading jobs...", { exact: true })).toHaveCount(0);
    await page.unroute("**/api/jobs?**");
    await page.getByRole("button", { name: "Retry job search" }).click();
    await page.getByLabel("Search jobs by title, company, or keyword").fill("E2E");
    await expect(page.getByRole("heading", { name: "E2E Housekeeping Aide", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry job search" })).toHaveCount(0);
    await page.close();
  });

  test("clears old results after a network failure on a changed search", async () => {
    const page = await context.newPage();
    await page.goto("/career#jobs");
    await page.getByLabel("Search jobs by title, company, or keyword").fill("E2E");
    await expect(page.getByRole("heading", { name: "E2E Housekeeping Aide", exact: true })).toBeVisible();
    await page.route("**/api/jobs?**", (route) => route.abort("failed"));
    await page.getByLabel("Search jobs by title, company, or keyword").fill("Housekeeping");
    await expect(page.getByRole("button", { name: "Retry job search" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Housekeeping Aide", exact: true })).toHaveCount(0);
    await expect(page.getByText("Loading jobs...", { exact: true })).toHaveCount(0);
    await page.unroute("**/api/jobs?**");
    await page.getByRole("button", { name: "Retry job search" }).click();
    await expect(page.getByRole("heading", { name: "E2E Housekeeping Aide", exact: true })).toBeVisible();
    await page.close();
  });
});
