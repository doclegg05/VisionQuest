import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, cssTokenValue } from "@/lib/wcag-contrast";

/**
 * Destructive buttons (Delete, Remove, Discard) need their own ink token, the
 * same way accent fills have --on-accent. useConfirm painted white on red-500,
 * 3.76:1 (HIG review A-6). No single ink passes on both themes' --error.
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("--on-error", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`clears 4.5:1 on --error in the ${theme} theme`, () => {
      const ink = cssTokenValue(css, "--on-error", theme);
      const fill = cssTokenValue(css, "--error", theme);
      assert.ok(ink && fill, "--on-error and --error must both be declared");
      const ratio = contrastRatio(ink, fill);
      assert.ok(ratio >= 4.5, `${theme}: ${ink} on ${fill} is ${ratio.toFixed(2)}:1`);
    });
  }
});
