import type { RegionOption } from "./region-pick";

function isRegionOption(value: unknown): value is RegionOption {
  if (typeof value !== "object" || value === null) return false;
  const { id, name } = value as Record<string, unknown>;
  return typeof id === "string" && id !== "" && typeof name === "string";
}

/** Reads the `regions` list of GET /api/teacher/classes. Null when it is not one. */
export function parseClassRegions(payload: unknown): RegionOption[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { regions } = payload as Record<string, unknown>;
  if (!Array.isArray(regions) || !regions.every(isRegionOption)) return null;
  return regions.map(({ id, name }) => ({ id, name }));
}

export const RELOAD_REGIONS_FAILED = "We could not load the new list of regions. Reload the page to see it.";

/**
 * The regions this person may put a class in, fetched again after the Regions
 * card changes one. Throws with words to show when the list cannot be read.
 */
export async function fetchClassRegions(fetcher: typeof fetch = fetch): Promise<RegionOption[]> {
  const response = await fetcher("/api/teacher/classes");
  const regions = response.ok ? parseClassRegions(await response.json()) : null;
  if (!regions) throw new Error(RELOAD_REGIONS_FAILED);
  return regions;
}
