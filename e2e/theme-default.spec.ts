import { test, expect, type Browser } from "@playwright/test";

/**
 * E2E: with no saved choice, the app follows the device's appearance.
 *
 * Production rendered dark for a phone set to Light (2026-10-09, HIG review
 * A-1). The server now omits data-theme and a nonce'd <head> script sets it
 * from prefers-color-scheme before first paint. A CSP-blocked script would
 * fail silently and leave every visitor on light, so the console is checked
 * too. Public route only: the root layout is the same for every page, and no
 * login means no shared rate-limit budget.
 */

async function landing(browser: Browser, opts: { os: "light" | "dark"; saved?: "light" | "dark" }) {
  const context = await browser.newContext({ colorScheme: opts.os });
  if (opts.saved) {
    const { origin } = new URL(test.info().project.use.baseURL ?? "http://localhost:3000");
    await context.addCookies([{ name: "vq-theme", value: opts.saved, url: origin }]);
  }
  const page = await context.newPage();
  const cspErrors: string[] = [];
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      hydrationErrors.push(message.text().slice(0, 300));
    }
    // Scripts only: the dev server's injected inline styles trip style-src-elem,
    // which is unrelated to whether the theme boot script ran.
    if (message.type() === "error" && /Content Security Policy/i.test(message.text()) && /script/i.test(message.text())) {
      cspErrors.push(message.text());
    }
  });
  await page.goto("/");
  // Hydration errors arrive after load; give React a moment to report them.
  await page.waitForTimeout(1_500);
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await context.close();
  return { theme, cspErrors, hydrationErrors };
}

test.describe("theme default follows the device", () => {
  for (const os of ["light", "dark"] as const) {
    test(`a device set to ${os} with nothing saved gets ${os}`, async ({ browser }) => {
      const { theme, cspErrors, hydrationErrors } = await landing(browser, { os });
      expect(theme).toBe(os);
      expect(cspErrors, "the theme boot script must not be blocked by CSP").toEqual([]);
      // Browsers blank a script's nonce attribute after parsing, which React
      // would otherwise report as a server/client mismatch.
      expect(hydrationErrors, "the theme boot script must hydrate cleanly").toEqual([]);
    });
  }

  test("a saved choice wins over the device", async ({ browser }) => {
    expect((await landing(browser, { os: "light", saved: "dark" })).theme).toBe("dark");
    expect((await landing(browser, { os: "dark", saved: "light" })).theme).toBe("light");
  });
});
