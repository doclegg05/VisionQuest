import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SPOKES_CHART_SERIES, SPOKES_COLORS, isPaletteColor, nearestPaletteColor } from "./spokes-palette";

describe("SPOKES palette", () => {
  it("holds the 11 SPOKES colors plus accent-text", () => {
    assert.equal(SPOKES_COLORS.size, 12);
    assert.equal(SPOKES_COLORS.get("accent-text"), "#1e7a2e");
  });

  it("accepts palette colors in any case, shorthand, alpha, or rgba form", () => {
    for (const ok of ["#004071", "#004071CC", "#FFF", "rgba(0, 64, 113, 0.05)", "rgb(211, 178, 87)", "white", "transparent"]) {
      assert.ok(isPaletteColor(ok), ok);
    }
  });

  it("rejects everything else", () => {
    for (const bad of ["#c43c3c", "#4a4d54", "black", "rgba(0, 0, 0, 0.5)", "hsl(200 50% 50%)", "rgb(0 64 113 / 5%)"]) {
      assert.equal(isPaletteColor(bad), false, bad);
    }
  });

  it("orders six chart colors from the palette", () => {
    assert.equal(SPOKES_CHART_SERIES.length, 6);
    assert.ok(SPOKES_CHART_SERIES.every(isPaletteColor));
  });

  it("suggests the nearest palette color for a stray hex", () => {
    assert.equal(nearestPaletteColor("#c43c3c"), "mauve");
    assert.equal(nearestPaletteColor("#0a1628"), "royal");
  });
});
