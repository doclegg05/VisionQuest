import { spokesColor } from "@/lib/spokes-palette";
import { contrastRatio } from "@/lib/wcag-contrast";

/** Seeded regions paint at full strength so label contrast does not depend on the card behind them. */
export const SEEDED_OPACITY = 1;
/** Regions without a seed row are faded; their label uses the theme's ink-strong. */
export const UNSEEDED_OPACITY = 0.35;
/** Theme token for region outlines: 6.0:1 on the light card and well above 3:1 on the dark one. */
export const REGION_STROKE_TOKEN = "--border-control";

/** Label ink (white or royal) with the higher contrast against an opaque region fill. */
export function labelInk(fill: string): string {
  const dark = spokesColor("royal");
  const light = spokesColor("light");
  return contrastRatio(light, fill) >= contrastRatio(dark, fill) ? light : dark;
}
