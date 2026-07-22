import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * E2E: Automated accessibility scans (axe-core) for public routes.
 *
 * This is the gate behind `npm run test:a11y`, consumed by the /a11y-pipeline
 * workflow. Scans assert zero violations against the WCAG 2.0/2.1 A+AA
 * rulesets — fix the page, never filter the rule.
 *
 * Scope: public routes only. Authenticated pages (dashboard, chat, teacher
 * views) need a seeded test user before they can be scanned — see
 * docs/superpowers/plans/2026-06-10-a11y-results.md "Honest scope notes".
 */
const PUBLIC_ROUTES = [
  { path: "/", name: "landing page" },
  { path: "/teacher-register", name: "teacher registration" },
  { path: "/forgot-password", name: "forgot password" },
] as const;

test.describe("Accessibility — public routes (WCAG 2.x A/AA)", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} (${route.path}) has no axe violations`, async ({ page }) => {
      await page.goto(route.path);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      // Map violations to a compact shape so a failure prints the rule id,
      // impact, and offending selectors — gate-runner reports this verbatim.
      const violations = results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target.join(" ")),
      }));

      expect(violations).toEqual([]);
    });
  }
});
