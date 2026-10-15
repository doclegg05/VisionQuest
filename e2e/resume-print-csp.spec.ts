import { test, expect, type Page } from "@playwright/test";
import { buildResumePrintHtml, EMPTY_RESUME } from "../src/lib/resume";
import { withStyleNonce } from "../src/lib/resume-print";

/**
 * E2E: the printed resume keeps its styles under the app's CSP.
 *
 * A window opened with window.open("") is about:blank and inherits the
 * opener's Content Security Policy. The app's policy allows <style> only with
 * the page nonce, so the resume's inline stylesheet was dropped and the print
 * came out unstyled (code review of HIG Phase 1, 2026-10-09). The unit test's
 * fake window has no CSP, so this has to run in a real browser.
 *
 * Self-contained: the page is served by page.route with the same style-src-elem
 * shape as src/proxy.ts, so no app server or login is involved.
 */

const NONCE = "dGVzdC1ub25jZS0xMjM0";
const ORIGIN = "https://csp-probe.test";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `style-src-elem 'self' 'nonce-${NONCE}' https://fonts.googleapis.com`,
  "style-src-attr 'unsafe-inline'",
].join("; ");

async function printedBodyMargin(page: Page, html: string): Promise<string> {
  await page.route(`${ORIGIN}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": CSP },
      body: `<!doctype html><button id="print">Print</button><script nonce="${NONCE}">
        document.getElementById("print").addEventListener("click", () => {
          const w = window.open("", "_blank");
          w.opener = null;
          w.document.open();
          w.document.write(${JSON.stringify(html)});
          w.document.close();
          window.__margin = w.getComputedStyle(w.document.body).marginTop;
        });
      </script>`,
    }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.click("#print");
  return page.evaluate(() => (window as unknown as { __margin: string }).__margin);
}

/** The on-screen preview: a sandboxed srcdoc iframe built from the same HTML. */
async function previewBodyMargin(page: Page, html: string): Promise<string> {
  await page.route(`${ORIGIN}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": CSP },
      body: `<!doctype html><iframe id="preview" sandbox="" srcdoc="${html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`,
    }),
  );
  await page.goto(`${ORIGIN}/`);
  const frame = await (await page.waitForSelector("#preview")).contentFrame();
  if (!frame) throw new Error("preview frame not found");
  await frame.waitForLoadState();
  return frame.evaluate(() => getComputedStyle(document.body).marginTop);
}

test.describe("resume print under the app CSP", () => {
  const resumeHtml = buildResumePrintHtml("Test Student", EMPTY_RESUME);

  test("the stylesheet is blocked without the page nonce", async ({ page }) => {
    expect(await printedBodyMargin(page, resumeHtml)).toBe("8px");
  });

  test("the stylesheet applies once it carries the page nonce", async ({ page }) => {
    expect(await printedBodyMargin(page, withStyleNonce(resumeHtml, NONCE))).toBe("0px");
  });

  test("the preview's stylesheet is blocked without the page nonce", async ({ page }) => {
    expect(await previewBodyMargin(page, resumeHtml)).toBe("8px");
  });

  test("the preview's stylesheet applies once it carries the page nonce", async ({ page }) => {
    expect(await previewBodyMargin(page, withStyleNonce(resumeHtml, NONCE))).toBe("0px");
  });
});
