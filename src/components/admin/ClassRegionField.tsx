import type { RegionOption } from "./region-pick";

interface ClassRegionFieldProps {
  /** The active regions this person may put a class in. */
  regions: readonly RegionOption[];
  /** The class's region now, or null when it has none. */
  currentRegion: RegionOption | null;
  /** The picked region id. It starts on the current region. */
  value: string;
  onChange: (regionId: string) => void;
}

/** The options to show: the current region stays even when it is not on offer. */
function optionsFor(regions: readonly RegionOption[], current: RegionOption | null): readonly RegionOption[] {
  if (!current || regions.some((region) => region.id === current.id)) return regions;
  return [current, ...regions];
}

/** The Region select in class settings. Shown on the admin page only. */
export function ClassRegionField({ regions, currentRegion, value, onChange }: ClassRegionFieldProps) {
  return (
    <div className="space-y-1.5 md:col-span-2">
      <label htmlFor="class-settings-region" className="block text-sm font-medium text-[var(--ink-strong)]">
        Region
      </label>
      <select
        id="class-settings-region"
        aria-describedby="class-settings-region-help"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field min-h-11 px-4 py-3 text-sm"
      >
        {currentRegion === null && <option value="">Pick a region</option>}
        {optionsFor(regions, currentRegion).map((region) => (
          <option key={region.id} value={region.id}>
            {region.name}
          </option>
        ))}
      </select>
      <p id="class-settings-region-help" className="text-xs text-[var(--ink-muted)]">
        To move this class, pick a region. Then press Save Settings.
      </p>
    </div>
  );
}

/** "Region: North" in the class header, for everyone who can open the class. */
export function ClassRegionLine({ region }: { region: RegionOption | null }) {
  return <p className="mt-2 text-sm text-[var(--ink-muted)]">Region: {region ? region.name : "None yet"}</p>;
}
