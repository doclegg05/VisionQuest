import { test, expect } from "@playwright/test";

/**
 * E2E: Teacher registration and dashboard.
 *
 * Verifies that:
 * 1. The teacher registration page loads
 * 2. Form validation works (password mismatch)
 * 3. Teacher key validation is enforced
 *
 * Note: Full teacher dashboard access requires a seeded teacher user.
 * These tests verify the registration UI contract.
 */
test.describe("Teacher registration", () => {
  test("teacher registration page loads", async ({ page }) => {
    await page.goto("/teacher-register");
    await expect(
      page.getByRole("heading", { name: /teacher registration/i }),
    ).toBeVisible();
  });

  test("teacher registration validates password mismatch", async ({ page }) => {
    await page.goto("/teacher-register");

    await page.getByLabel("Teacher Key").fill("test-key");
    await page.getByLabel("Full Name").fill("Test Teacher");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm Password", { exact: true }).fill("different123");

    await page.getByRole("button", { name: /create teacher account/i }).click();

    await expect(
      page.getByText(/passwords do not match/i),
    ).toBeVisible();
  });

  test("teacher registration validates empty teacher key", async ({ page }) => {
    await page.goto("/teacher-register");

    await page.getByLabel("Full Name").fill("Test Teacher");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm Password", { exact: true }).fill("password123");

    await page.getByRole("button", { name: /create teacher account/i }).click();

    // Should show validation error or stay on page
    await expect(page).toHaveURL(/teacher-register/);
  });
});

test.describe("Teacher dashboard access", () => {
  test("unauthenticated access to /teacher redirects to login", async ({ page }) => {
    await page.goto("/teacher");

    // Should redirect to login page
    await page.waitForURL(/^\/$|\/login/, { timeout: 10_000 });
  });
});
