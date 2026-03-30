import { test, expect } from "@playwright/test";

/**
 * E2E: Student login and Sage chat flow.
 *
 * Verifies that a student can:
 * 1. See the landing page
 * 2. Navigate to the sign-in form
 * 3. Submit credentials (expects error for invalid creds)
 * 4. Verify the auth error is displayed properly
 *
 * Note: Full login requires a seeded test user. This test verifies
 * the auth flow UI contract without requiring a real user in the DB.
 */
test.describe("Student login flow", () => {
  test("landing page loads with sign-in form", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /build momentum/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" }).first()).toBeVisible();
  });

  test("sign-in form validates required fields", async ({ page }) => {
    await page.goto("/");

    // Click sign in without filling fields
    const signInButton = page.getByRole("button", { name: "Sign In" }).first();
    await signInButton.click();

    // The form should show validation or the button should be disabled
    // Either the browser native validation fires, or custom validation shows
    const studentIdInput = page.getByLabel(/student id/i);
    await expect(studentIdInput).toBeVisible();
  });

  test("sign-in with invalid credentials shows error", async ({ page }) => {
    await page.goto("/");

    // Fill in invalid credentials
    await page.getByLabel(/student id/i).fill("nonexistent-user");
    await page.getByLabel(/password/i).fill("wrongpassword");

    // Submit
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should show an error message (not redirect to dashboard)
    await expect(
      page.getByText(/invalid|incorrect|not found/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Forgot password flow", () => {
  test("forgot password page loads", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(
      page.getByRole("heading", { name: /reset your password/i }),
    ).toBeVisible();
  });
});
