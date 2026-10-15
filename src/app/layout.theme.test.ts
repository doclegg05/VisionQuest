import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The root layout must let the device decide the theme when nothing is saved:
 * omit data-theme on the server and set it from prefers-color-scheme before
 * first paint. The script carries the CSP nonce, or the browser drops it and
 * every system-preference visitor gets light whatever their device says.
 * e2e/theme-default.spec.ts proves the same end to end.
 */

const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("root layout theme", () => {
  it("reads the saved preference, which defaults to system", () => {
    assert.match(layout, /getThemePreferenceFromCookie\(/);
  });

  it("renders data-theme only for an explicit choice", () => {
    assert.match(layout, /data-theme=\{preference === "system" \? undefined : preference\}/);
  });

  it("sets the theme before paint with a nonce'd boot script", () => {
    assert.match(layout, /<script\s+nonce=\{nonce\}\s+dangerouslySetInnerHTML=\{\{ __html: THEME_BOOT_SCRIPT \}\}/);
    assert.match(layout, /get\("x-csp-nonce"\)/);
  });

  it("tells React the boot script may change <html> before hydration", () => {
    assert.match(layout, /<html[^>]*suppressHydrationWarning/);
  });

  it("tints Safari's chrome to match each appearance", () => {
    assert.match(layout, /media: "\(prefers-color-scheme: light\)"/);
    assert.match(layout, /media: "\(prefers-color-scheme: dark\)"/);
  });
});
