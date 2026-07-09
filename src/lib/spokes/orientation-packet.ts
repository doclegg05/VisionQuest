// =============================================================================
// Orientation Packet
// Derives the complete, correctly-ordered set of onboarding forms an instructor
// prints to run a paper-based student orientation. Source of truth is FORMS in
// ./forms.ts — this module never hardcodes a second list that could drift.
// =============================================================================

import { FORMS, type SpokesForm } from "./forms";

export interface OrientationPacket {
  /** Onboarding forms with a real PDF in storage, in orientation order. */
  printable: SpokesForm[];
  /**
   * Onboarding forms that are part of orientation but have no digital PDF yet
   * (storageKey === null). The instructor supplies these on paper; they are
   * listed on the packet cover so nothing is silently dropped.
   */
  paperOnly: SpokesForm[];
}

/**
 * Returns the onboarding forms in orientation order, split by whether a
 * printable PDF exists. Ordering is by `sortOrder`, then by declaration order
 * for stable output when two forms share a `sortOrder`.
 */
export function getOrientationPacket(): OrientationPacket {
  const onboarding = FORMS
    .map((form, index) => ({ form, index }))
    .filter(({ form }) => form.category === "onboarding")
    .sort((a, b) => a.form.sortOrder - b.form.sortOrder || a.index - b.index)
    .map(({ form }) => form);

  const printable: SpokesForm[] = [];
  const paperOnly: SpokesForm[] = [];
  for (const form of onboarding) {
    if (form.storageKey) {
      printable.push(form);
    } else {
      paperOnly.push(form);
    }
  }

  return { printable, paperOnly };
}
