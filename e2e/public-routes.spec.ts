import { test, expect } from "@playwright/test";

/**
 * E2E: Public routes and API health.
 *
 * Verifies that public-facing routes render correctly and
 * the health endpoint returns expected shape.
 */
test.describe("Health check", () => {
  test("GET /api/health returns healthy status", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe("healthy");
    expect(body.db).toBe("connected");
  });
});

test.describe("Public pages", () => {
  test("landing page renders hero and sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /build momentum/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" }).first()).toBeVisible();
  });

  test("forgot password page renders", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
  });

  test("teacher registration page renders", async ({ page }) => {
    await page.goto("/teacher-register");
    await expect(page.getByRole("heading", { name: /(teacher|staff) registration/i })).toBeVisible();
  });
});

test.describe("Protected API routes reject unauthenticated requests", () => {
  const protectedRoutes = [
    "/api/auth/session",
    "/api/goals",
    "/api/chat/conversations",
    "/api/notifications",
    "/api/portfolio",
    "/api/files",
  ];

  for (const route of protectedRoutes) {
    test(`GET ${route} returns 401`, async ({ request }) => {
      const response = await request.get(route);
      expect(response.status()).toBe(401);
    });
  }
});
