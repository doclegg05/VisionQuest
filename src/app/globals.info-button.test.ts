import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, cssTokenValue } from "@/lib/wcag-contrast";

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const BUTTON_FILES = [
  "src/components/orientation/OrientationChecklist.tsx",
  "src/components/orientation/OrientationWizard.tsx",
  "src/components/portfolio/PortfolioGrid.tsx",
  "src/components/portfolio/ResumeBuilder.tsx",
];

describe("filled info buttons darken on hover and keep their ink", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} theme: --info-on clears 4.5:1 on --info-fill and on the --dark hover`, () => {
      const on = cssTokenValue(css, "--info-on", theme) as string;
      for (const ground of ["--info-fill", "--dark"]) {
        const value = cssTokenValue(css, ground, theme) as string;
        const ratio = contrastRatio(on, value);
        assert.ok(ratio >= 4.5, `${on} on ${ground} ${value} is ${ratio.toFixed(2)}:1`);
      }
    });
  }

  it("uses text-on-info with hover:bg-brand-dark, never literal text-white or a lighter hover", () => {
    for (const file of BUTTON_FILES) {
      const lines = readFileSync(join(root, file), "utf8").split("\n").filter((l) => l.includes("bg-info "));
      assert.ok(lines.length > 0, file);
      for (const line of lines) {
        assert.doesNotMatch(line, /bg-info text-white|hover:bg-info/, `${file}: ${line.trim()}`);
        assert.match(line, /text-on-info/, `${file}: ${line.trim()}`);
        assert.match(line, /hover:bg-brand-dark/, `${file}: ${line.trim()}`);
      }
    }
  });
});
