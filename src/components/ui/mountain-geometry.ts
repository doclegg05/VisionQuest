// Pure layout for the mountain canvas, so a test can prove the score badge
// never covers a milestone marker or label. Canvas text cannot be measured
// without a DOM, so label width uses a deliberately generous per-character width.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MilestonePlace {
  label: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
}

export const LABEL_FONT_PX = 13;
const LABEL_CHAR_WIDTH = 8;
const MARKER_RADIUS = 8;
export const BADGE_WIDTH = 136;
export const BADGE_HEIGHT = 48;
const BADGE_MARGIN = 16;

/** Canvas height by container width, as `handleResize` sets it. */
export function canvasHeight(width: number): number {
  return width < 640 ? 200 : width < 768 ? 260 : 320;
}

/** The marker and the label to its right, as one box. */
export function milestoneRect(m: MilestonePlace, w: number, h: number): Rect {
  const px = m.x * w;
  const py = m.y * h;
  const labelWidth = m.label.length * LABEL_CHAR_WIDTH;
  return {
    x: px - MARKER_RADIUS,
    y: py - LABEL_FONT_PX,
    w: MARKER_RADIUS + 10 + labelWidth,
    h: LABEL_FONT_PX + MARKER_RADIUS,
  };
}

/** Score badge box, in the lower-right corner where no milestone sits. */
export function badgeRect(w: number, h: number): Rect {
  return { x: w - BADGE_MARGIN - BADGE_WIDTH, y: h - BADGE_MARGIN - BADGE_HEIGHT + 4, w: BADGE_WIDTH, h: BADGE_HEIGHT };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
