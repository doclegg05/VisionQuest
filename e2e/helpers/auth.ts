import type { Browser, BrowserContext } from "@playwright/test";
import type { E2eUserFixture } from "../fixtures";

/**
 * Same fallback expression as playwright.config.ts — beforeAll hooks only
 * see worker-scoped fixtures, so the test-scoped `baseURL` fixture is not
 * available where contexts get created.
 */
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/**
 * Log a fixture user in via the real /api/auth/login endpoint and return a
 * browser context carrying the vq-session httpOnly cookie.
 *
 * API login (not the sign-in form) keeps the login count low on purpose:
 * /api/auth/login rate-limits to 10 attempts per IP per 15 minutes, so each
 * spec logs each user in exactly once and shares the context across scans.
 * The Origin header satisfies the CSRF middleware on POST /api/*.
 */
export async function loginContext(
  browser: Browser,
  user: E2eUserFixture,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const response = await context.request.post("/api/auth/login", {
    data: { studentId: user.login, password: user.password },
    headers: { Origin: BASE_URL },
  });

  if (!response.ok()) {
    const body = await response.text().catch(() => "<unreadable>");
    await context.close();
    throw new Error(
      `Login failed for ${user.login}: HTTP ${response.status()} ${body} — ` +
        "did the fixture seed run? (npx tsx scripts/seed-e2e-users.ts)",
    );
  }

  return context;
}
