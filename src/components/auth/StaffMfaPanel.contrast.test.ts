import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Dark-mode contrast regression gate for StaffMfaPanel.
 *
 * The bug class: a hardcoded `bg-white` surface whose text uses adaptive ink
 * tokens (--ink-strong is near-white under [data-theme="dark"]) renders
 * near-white-on-white in dark mode. Fixed 2026-07-22 by swapping to the
 * adaptive `bg-[var(--surface-raised)]` token (same fix as /forgot-password,
 * June a11y pass). The axe e2e gate cannot reach this auth-gated panel, so
 * this source-level check is the automated regression guard.
 */
const source = readFileSync(
  join(process.cwd(), "src/components/auth/StaffMfaPanel.tsx"),
  "utf8"
);

test("StaffMfaPanel has no hardcoded bg-white surfaces", () => {
  const hardcodedWhite = source.match(/\bbg-white\b/g) ?? [];
  assert.deepEqual(
    hardcodedWhite,
    [],
    "bg-white with ink-token text is unreadable under [data-theme=\"dark\"] — use bg-[var(--surface-raised)]"
  );
});

test("StaffMfaPanel cards use the adaptive surface token", () => {
  const adaptiveSurfaces = source.match(/bg-\[var\(--surface-raised\)\]/g) ?? [];
  // Outer container plus the five converted cards.
  assert.ok(
    adaptiveSurfaces.length >= 6,
    `expected >= 6 bg-[var(--surface-raised)] uses, found ${adaptiveSurfaces.length}`
  );
});

test("danger styles use the danger role pair (no over-sweep, no raw red)", () => {
  // SPOKES sweep: the error box and the danger button hover moved from the
  // hardcoded bg-red-50 / text-red-700 pair to the danger role, whose soft
  // surface and text token are tuned together for both themes (white text in
  // dark, where no SPOKES red clears 4.5:1). They must keep the pairing.
  const soft = source.match(/bg-danger-soft|hover:bg-danger-soft/g) ?? [];
  assert.ok(soft.length >= 2, `expected the two danger-soft uses to remain, found ${soft.length}`);
  assert.doesNotMatch(source, /\b(bg|text|border)-red-\d+/, "raw red palette classes must not come back");
});
