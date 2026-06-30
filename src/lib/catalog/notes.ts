// =============================================================================
// Catalog notes — answer-time disambiguation lookup
//
// Loads the same generated overlay file `catalog:sync` writes
// (config/form-routing.generated.json), but for a different purpose than
// form-search.ts's old (reverted) use of it: NOT folded into a retrieval
// index, only read at answer time so Sage can reason about already-retrieved
// candidates using the curated when-to-use / when-NOT-to-use text. Absent
// until `catalog:sync` has run at least once; all consumers must degrade
// gracefully (empty note, not-ambiguous) when the file doesn't exist.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import type { FormRoutingEntry, FormRoutingOverlay } from "./schema";

let overlayCache: FormRoutingOverlay | null | undefined;

function loadOverlay(): FormRoutingOverlay | null {
  if (overlayCache !== undefined) return overlayCache;
  try {
    overlayCache = existsSync("config/form-routing.generated.json")
      ? (JSON.parse(readFileSync("config/form-routing.generated.json", "utf8")) as FormRoutingOverlay)
      : null;
  } catch {
    overlayCache = null;
  }
  return overlayCache;
}

/** The curated catalog note for a form id, or null if uncatalogued / file absent. */
export function getFormCatalogNote(formId: string): FormRoutingEntry | null {
  return loadOverlay()?.entries[formId] ?? null;
}

/**
 * A form is "known-ambiguous" when its catalog node documents a sibling it's
 * commonly confused with (non-empty whenNotToUse). Used to decide when a
 * deterministic, no-model answer is too risky to give confidently.
 */
export function isKnownAmbiguousForm(formId: string): boolean {
  return Boolean(getFormCatalogNote(formId)?.whenNotToUse);
}

/** Test seam: inject or clear the notes cache without touching the filesystem. */
export function __setFormCatalogNotesForTest(o: FormRoutingOverlay | null): void {
  overlayCache = o;
}

/** Test seam: force the next read to re-check the filesystem. */
export function __resetFormCatalogNotesCache(): void {
  overlayCache = undefined;
}
