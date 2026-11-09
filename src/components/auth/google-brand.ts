/**
 * Google's sign-in mark must keep Google's four brand colors, so these four are
 * the one place in the app that is allowed to sit outside the SPOKES palette.
 */
/* eslint-disable spokes/no-off-palette-color -- Google brand guidelines */
export const GOOGLE_BRAND_COLORS = {
  blue: "#4285F4",
  green: "#34A853",
  yellow: "#FBBC05",
  red: "#EA4335",
} as const;
/* eslint-enable spokes/no-off-palette-color */
