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
 * /api/auth/login allows 30 failed sign-ins per address and 5 per account per
 * 15 minutes. A sign-in that works gives both units back, but each attempt
 * holds its units until it is answered, so each spec logs each user in
 * exactly once and shares the context across scans.
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
    const status = response.status();
    const body = await response.text().catch(() => "<unreadable>");
    await context.close();
    // A 429 here is almost always /api/auth/login's own per-address limiter
    // (30 failed sign-ins per 15 minutes, see this file's header) rather than
    // a seeding problem: failed sign-ins from collectors that share one
    // address in the same `--workers=1` invocation can use it up before every
    // spec gets to run (PR review round 2). The seed hint stays for every
    // OTHER status, since a real seed gap (401/404) looks nothing like this.
    const hint =
      status === 429
        ? "the per-address sign-in limit (30 failed tries/15min) is exhausted, not a seed problem — " +
          "either this spec made too many failed sign-ins on its own, or another collector in the " +
          "same CI step already used up the budget"
        : "did the fixture seed run? (npx tsx scripts/seed-e2e-users.ts)";
    throw new Error(`Login failed for ${user.login}: HTTP ${status} ${body} — ${hint}`);
  }

  return context;
}
