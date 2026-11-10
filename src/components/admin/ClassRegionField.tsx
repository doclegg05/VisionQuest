interface ClassRegionFieldProps {
  /** The active regions this person may put a class in. */
  regions: readonly { id: string; name: string }[];
  /** The picked region id, or "" to keep the class where it is. */
  value: string;
  onChange: (regionId: string) => void;
}

/**
 * The Region select in class settings. The class routes do not return a
 * class's region, so it starts on "Keep the current region" every time.
 */
export function ClassRegionField({ regions, value, onChange }: ClassRegionFieldProps) {
  if (regions.length === 0) return null;
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
        <option value="">Keep the current region</option>
        {regions.map((region) => (
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
