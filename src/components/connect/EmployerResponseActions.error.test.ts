import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The error branch only renders after a failed request, so the check reads the source:
// plain `text-danger` text reads as body text in dark, where danger text is white.
const SOURCES = {
  "EmployerResponseActions": new URL("./EmployerResponseActions.tsx", import.meta.url),
  "RecoverySetupForm": new URL("../auth/RecoverySetupForm.tsx", import.meta.url),
};

for (const [name, url] of Object.entries(SOURCES)) {
  describe(`${name} error`, () => {
    const source = readFileSync(url, "utf8");
    const alert = source.match(/<(p|div)[^>]*role="alert"[^>]*>[\s\S]*?<\/\1>/)?.[0] ?? "";

    it("is an alert", () => {
      assert.ok(alert, "expected a role=alert element");
    });

    it("sits in the danger box with an icon, like the sign-in alert", () => {
      assert.match(alert, /\bbg-danger-soft\b/);
      assert.match(alert, /<WarningCircle\b[^>]*aria-hidden="true"/);
    });
  });
}
