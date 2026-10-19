import { expect, test } from "@playwright/test";
import { DEMO_ENTER_INSTRUCTOR, DEMO_ENTER_STUDENT, DEMO_SIGNIN_NOTE } from "../src/lib/demo/copy";
import { BASE_URL } from "./helpers/auth";

/**
 * E2E: with the cohort demo switch off, the app is exactly what it was before
 * demo mode existed. The twin of e2e/cohort-demo.spec.ts, which needs the
 * switch on.
 *
 * Runs in the first "E2E gate" step of the e2e job in .github/workflows/ci.yml,
 * where COHORT_DEMO_MODE is not set. The sign-in page is rendered per request
 * and reads the switch then, so one build serves both specs.
 *
 * The button labels come from src/lib/demo/copy.ts, never from literal text:
 * a label that changed in copy.ts would otherwise leave these "no button"
 * checks passing on a string nobody renders any more.
 */
test.skip(
  process.env.COHORT_DEMO_MODE === "true",
  "The app was started with COHORT_DEMO_MODE=true; e2e/cohort-demo.spec.ts covers that mode.",
);

test.describe("Cohort demo mode off", () => {
  test("the sign-in page keeps its form and shows no demo block", async ({ page }) => {
    await page.goto("/");

    // The form first: it proves the page rendered, so the zero counts below
    // cannot pass on an error page.
    await expect(page.getByLabel(/username or email/i)).toBeVisible();

    await expect(page.getByRole("button", { name: DEMO_ENTER_STUDENT })).toHaveCount(0);
    await expect(page.getByRole("button", { name: DEMO_ENTER_INSTRUCTOR })).toHaveCount(0);
    await expect(page.getByText(DEMO_SIGNIN_NOTE)).toHaveCount(0);

    // The block the demo buttons replace is back: the Google button where
    // Google sign-in is configured, or its note where it is not (CI has no
    // Google credentials, so the note is what shows there).
    await expect(
      page.getByRole("link", { name: /sign in with google/i }).or(page.getByText(/google sign-in is not enabled/i)),
    ).toBeVisible();
  });

  for (const endpoint of ["/api/demo/student", "/api/demo/instructor"]) {
    test(`POST ${endpoint} answers 404`, async ({ request }) => {
      // A same-origin Origin gets the request past the proxy's CSRF check, so
      // the 404 comes from the route itself and not from an origin refusal.
      const response = await request.post(endpoint, { headers: { Origin: BASE_URL } });

      expect(response.status()).toBe(404);
    });
  }
});
