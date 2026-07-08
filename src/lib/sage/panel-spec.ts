// =============================================================================
// Sage Panel Spec — the ONLY shape Sage-authored UI is allowed to take.
//
// Sage never writes HTML/JSX. The autonomous briefing run emits this JSON
// spec; a server component maps validated cards onto a fixed registry of
// React components. Every read re-validates with Zod — stored JSON is never
// trusted, so a bad/stale/tampered spec degrades to the static dashboard.
// =============================================================================

import { z } from "zod";
import { PLATFORM_MAP } from "./platform-map";

export const PANEL_SPEC_VERSION = 1;

/**
 * Internal hrefs a panel card may point at: exactly the static student
 * routes registered in PLATFORM_MAP. Derived (not hand-listed) so a new
 * student surface becomes linkable by updating the platform map only.
 * Dynamic-segment routes are excluded — a card can never mint an arbitrary
 * /teacher/students/<id>-style path.
 */
export const STUDENT_PANEL_ROUTES: ReadonlyArray<string> = [
  ...new Set(
    PLATFORM_MAP.filter(
      (entry) => entry.roles.includes("student") && entry.route && !entry.route.includes("["),
    ).map((entry) => entry.route as string),
  ),
];

export function isAllowedPanelRoute(href: string): boolean {
  return STUDENT_PANEL_ROUTES.includes(href);
}

const shortText = z.string().trim().min(1).max(140);
const bodyText = z.string().trim().min(1).max(280);
const internalHref = z
  .string()
  .refine(isAllowedPanelRoute, { message: "href is not an allowed student route" });

const panelCardSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("focus_today"),
    title: shortText,
    body: bodyText,
    // Verified against StudentTask ownership in briefing.ts before save.
    taskId: z.string().cuid().optional(),
  }),
  z.object({
    type: z.literal("progress_highlight"),
    title: shortText,
    body: bodyText,
    metricLabel: shortText.optional(),
    metricValue: z.string().trim().min(1).max(20).optional(),
  }),
  z.object({
    type: z.literal("next_steps"),
    title: shortText,
    steps: z
      .array(z.object({ label: shortText, href: internalHref.optional() }))
      .min(1)
      .max(4),
  }),
  z.object({
    type: z.literal("encouragement"),
    body: bodyText,
  }),
  z.object({
    type: z.literal("resource_pointer"),
    title: shortText,
    body: bodyText.optional(),
    href: internalHref,
  }),
]);

export const panelSpecSchema = z.object({
  // Renderer only understands versions it has components for; an unknown
  // version fails parse at read time and falls back to the static panels.
  version: z.literal(PANEL_SPEC_VERSION),
  cards: z.array(panelCardSchema).min(1).max(4),
});

export type PanelCard = z.infer<typeof panelCardSchema>;
export type PanelSpec = z.infer<typeof panelSpecSchema>;

/**
 * Parse an untrusted value (model output or stored Json) into a PanelSpec.
 * Returns null instead of throwing — callers treat any failure as "no panel".
 */
export function parsePanelSpec(value: unknown): PanelSpec | null {
  const result = panelSpecSchema.safeParse(value);
  return result.success ? result.data : null;
}
