export interface RegionOption {
  id: string;
  name: string;
}

/**
 * The region a form has picked, read from the list it has now. A pick that is
 * not in the list (nothing picked yet, or the list changed) becomes the first
 * region, so a form never sends a region it does not show.
 */
export function pickedRegionId(regions: readonly RegionOption[], picked: string): string {
  return regions.some((region) => region.id === picked) ? picked : (regions[0]?.id ?? "");
}
