import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { badgeRect, canvasHeight, LABEL_FONT_PX, milestoneRect, rectsIntersect } from "./mountain-geometry";
import { MILESTONES } from "./MountainProgress";

describe("mountain score badge", () => {
  for (const width of [375, 700, 1280]) {
    it(`covers no milestone marker or label at ${width}px wide`, () => {
      const h = canvasHeight(width);
      const badge = badgeRect(width, h);
      assert.ok(badge.x >= 0 && badge.x + badge.w <= width, "badge stays inside the canvas");
      assert.ok(badge.y >= 0 && badge.y + badge.h <= h, "badge stays inside the canvas");
      for (const m of MILESTONES) {
        assert.equal(rectsIntersect(badge, milestoneRect(m, width, h)), false, `${m.label} overlaps the badge at ${width}x${h}`);
      }
    });
  }

  it("keeps every canvas label at 13px or larger", () => {
    assert.ok(LABEL_FONT_PX >= 13);
  });
});
