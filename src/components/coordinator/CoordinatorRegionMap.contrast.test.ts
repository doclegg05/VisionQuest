import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPOKES_CHART_SERIES } from "@/lib/spokes-palette";
import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";
import { SEEDED_OPACITY, UNSEEDED_OPACITY, REGION_STROKE_TOKEN, labelInk } from "./region-map-style";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const mapSource = readFileSync(join(process.cwd(), "src/components/coordinator/CoordinatorRegionMap.tsx"), "utf8");

for (const theme of ["light", "dark"] as const) {
  const token = (name: string) => cssTokenValue(css, name, theme) as string;
  const card = token("--surface-raised");

  describe(`region map, ${theme} theme`, () => {
    it("every seeded region label is at least 4.5:1 against its composited fill", () => {
      for (const series of SPOKES_CHART_SERIES) {
        const fill = composite({ ...parseColor(series), a: SEEDED_OPACITY }, parseColor(card));
        const ratio = contrastRatio(labelInk(series), fill);
        assert.ok(ratio >= 4.5, `${series} at ${SEEDED_OPACITY}: ${ratio.toFixed(2)}:1`);
      }
    });

    it("an unseeded region's label (ink-strong) is at least 4.5:1 against its faded fill", () => {
      const ink = composite(parseColor(token("--ink-strong")), parseColor(card));
      for (const series of SPOKES_CHART_SERIES) {
        const fill = composite({ ...parseColor(series), a: UNSEEDED_OPACITY }, parseColor(card));
        const ratio = contrastRatio(ink, fill);
        assert.ok(ratio >= 4.5, `${series} at ${UNSEEDED_OPACITY}: ${ratio.toFixed(2)}:1`);
      }
    });

    it("the region boundary stroke is at least 3:1 against the card", () => {
      const stroke = composite(parseColor(token(REGION_STROKE_TOKEN)), parseColor(card));
      const ratio = contrastRatio(stroke, card);
      assert.ok(ratio >= 3, `${REGION_STROKE_TOKEN} on card: ${ratio.toFixed(2)}:1`);
    });
  });
}

it("the map draws region paths with the stroke token, not a literal rgba", () => {
  assert.match(mapSource, /REGION_STROKE_TOKEN/);
  assert.doesNotMatch(mapSource, /rgba\(0, ?19, ?63, ?0\.15\)/);
});
