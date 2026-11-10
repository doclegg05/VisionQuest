import { FIELD_CLASS, LABEL_CLASS } from "@/components/staff/fieldStyles";
import { REGION_MESSAGES } from "./regions-copy";
import { regionWithSameName, type AdminRegion } from "./regions-model";
import { ALERT_CLASS } from "./regionStyles";

interface RegionNameFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Every listed region, to warn about a name another one has. */
  regions: readonly AdminRegion[];
  /** The region being renamed, so its own name does not warn. */
  exceptId?: string;
  /** A failed save that belongs to this field. */
  error: string | null;
  autoFocus?: boolean;
}

/** A region name input, with a same-name warning and its error under it, both read out with it. */
export function RegionNameField({ id, label, value, onChange, regions, exceptId, error, autoFocus = false }: RegionNameFieldProps) {
  const sameName = regionWithSameName(regions, value, exceptId);
  const warningId = `${id}-warning`;
  const errorId = `${id}-error`;
  const describedBy = [sameName ? warningId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="min-w-48 flex-1">
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      <input
        id={id}
        required
        autoFocus={autoFocus}
        maxLength={200}
        autoComplete="off"
        aria-describedby={describedBy || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_CLASS}
      />
      {sameName && <p id={warningId} className="mt-1 text-sm text-[var(--ink-strong)]">{REGION_MESSAGES.sameName(sameName)}</p>}
      {error && <p id={errorId} role="alert" className={`mt-2 ${ALERT_CLASS}`}>{error}</p>}
    </div>
  );
}
