import { NoRegionsHint } from "./NoRegionsHint";
import type { RegionOption } from "./region-pick";

interface CreateClassRegionSelectProps {
  regions: readonly RegionOption[];
  value: string;
  onChange: (regionId: string) => void;
  /** The admin page has the Regions card; an instructor's page does not. */
  onAdminPage: boolean;
}

const LABEL = "block text-sm font-medium text-[var(--ink-strong)]";

/** The Region field in Create a Class, or the reason there is nothing to pick. */
export function CreateClassRegionSelect({ regions, value, onChange, onAdminPage }: CreateClassRegionSelectProps) {
  if (regions.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className={LABEL}>Region</p>
        {onAdminPage ? (
          <NoRegionsHint />
        ) : (
          <p className="text-sm text-[var(--ink-strong)]">You are not in a region yet. Ask your program admin to add you to one.</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor="new-class-region" className={LABEL}>Region</label>
      <select
        id="new-class-region"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field min-h-11 w-full px-4 py-3 text-sm"
      >
        <option value="">Pick a region</option>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>{region.name}</option>
        ))}
      </select>
    </div>
  );
}
