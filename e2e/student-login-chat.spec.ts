import { test, expect } from "@playwright/test";

/**
 * E2E: Student login and Sage chat flow.
 *
 * Verifies that a student can:
 * 1. See the landing page
 * 2. Interact with the sign-in form on the landing page
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
    await expect(page.getByLabel(/username or email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("sign-in form validates required fields", async ({ page }) => {
    await page.goto("/");

    const usernameInput = page.getByLabel(/username or email/i);
    const passwordInput = page.getByLabel(/password/i);
    const signInButton = page.getByRole("button", { name: "Sign In" }).first();

    await expect(usernameInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await signInButton.click();

    await expect(usernameInput).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });

  test("sign-in with invalid credentials shows error", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel(/username or email/i).fill("nonexistent-user");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

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
