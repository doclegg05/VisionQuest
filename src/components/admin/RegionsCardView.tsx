import { AddRegionForm } from "./AddRegionForm";
import { ActiveRegionRow, ArchivedRegionRow, type RegionRowHandlers } from "./RegionRows";
import type { NewRegionInput } from "./regions-api";
import { REGIONS_COPY, regionCountLabel } from "./regions-copy";
import type { AdminRegion } from "./regions-model";
import { failureFor, type ReadyState, type RegionsState } from "./regions-reducer";
import { ALERT_CLASS, MUTED_TEXT, SECONDARY_BUTTON, SUBHEADING } from "./regionStyles";

export interface RegionsHandlers extends RegionRowHandlers {
  onRetry: () => void;
  onToggle: () => void;
  /** Resolves true when the region was saved, so the form can clear. */
  onCreate: (input: NewRegionInput) => Promise<boolean>;
}

interface RegionsCardViewProps {
  state: RegionsState;
  handlers: RegionsHandlers;
}

const PANEL_ID = "regions-panel";

function isSaving(state: ReadyState, regionId: string): boolean {
  return state.busy?.kind === "region" && state.busy.regionId === regionId;
}

/** A card with no regions stays open: adding the first one is the only thing to do. */
function isOpen(state: ReadyState): boolean {
  return state.open || state.regions.length === 0;
}

function CardHeader({ state, onToggle }: { state: RegionsState; onToggle: () => void }) {
  const ready = state.kind === "ready" ? state : null;
  const active = ready?.regions.filter((region) => region.status === "active").length ?? 0;
  const total = ready?.regions.length ?? 0;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 id="regions-heading" className={SUBHEADING}>{REGIONS_COPY.heading}</h2>
        <p className={`mt-1 ${MUTED_TEXT}`}>{REGIONS_COPY.intro}</p>
        {ready && total > 0 && (
          <p className="mt-2 text-sm font-semibold text-[var(--ink-strong)]">{regionCountLabel(active, total - active)}</p>
        )}
        {/* Always in the page, so a screen reader hears each saved change. */}
        {ready && (
          <p role="status" className={ready.notice ? "mt-2 text-sm text-[var(--ink-strong)]" : "sr-only"}>{ready.notice}</p>
        )}
      </div>
      {ready && total > 0 && (
        <button type="button" aria-expanded={isOpen(ready)} aria-controls={PANEL_ID} onClick={onToggle} className={SECONDARY_BUTTON}>
          {isOpen(ready) ? REGIONS_COPY.close : REGIONS_COPY.open}
        </button>
      )}
    </div>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <p role="alert" className={ALERT_CLASS}>{message}</p>
      <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>{REGIONS_COPY.retry}</button>
    </div>
  );
}

interface RegionListProps {
  state: ReadyState;
  regions: readonly AdminRegion[];
  handlers: RegionsHandlers;
}

function ActiveRegions({ state, regions, handlers }: RegionListProps) {
  if (regions.length === 0) return null;
  return (
    <ul className="divide-y divide-[var(--border)]">
      {regions.map((region) => (
        <ActiveRegionRow
          key={region.id}
          region={region}
          regions={state.regions}
          people={state.people}
          busy={state.busy !== null}
          saving={isSaving(state, region.id)}
          error={failureFor(state, { kind: "region", regionId: region.id })}
          handlers={handlers}
        />
      ))}
    </ul>
  );
}

function ArchivedRegions({ state, regions, handlers }: RegionListProps) {
  if (regions.length === 0) return null;
  return (
    <div>
      <h3 className={SUBHEADING}>{REGIONS_COPY.archivedHeading}</h3>
      <ul className="divide-y divide-[var(--border)]">
        {regions.map((region) => (
          <ArchivedRegionRow
            key={region.id}
            region={region}
            busy={state.busy !== null}
            saving={isSaving(state, region.id)}
            error={failureFor(state, { kind: "region", regionId: region.id })}
            handlers={handlers}
          />
        ))}
      </ul>
    </div>
  );
}

function RegionsPanel({ state, handlers }: { state: ReadyState; handlers: RegionsHandlers }) {
  const active = state.regions.filter((region) => region.status === "active");
  const archived = state.regions.filter((region) => region.status === "archived");
  return (
    <div id={PANEL_ID} className="space-y-5">
      {state.regions.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-strong)]">
          {REGIONS_COPY.empty}
        </p>
      )}
      <ActiveRegions state={state} regions={active} handlers={handlers} />
      <ArchivedRegions state={state} regions={archived} handlers={handlers} />
      <AddRegionForm
        busy={state.busy !== null}
        adding={state.busy?.kind === "create"}
        error={failureFor(state, { kind: "create" })}
        onCreate={handlers.onCreate}
      />
    </div>
  );
}

export function RegionsCardView({ state, handlers }: RegionsCardViewProps) {
  return (
    <section aria-labelledby="regions-heading" className="theme-card space-y-5 rounded-xl p-5">
      <CardHeader state={state} onToggle={handlers.onToggle} />
      {state.kind === "loading" && <p className={MUTED_TEXT}>{REGIONS_COPY.loading}</p>}
      {state.kind === "load-failed" && <LoadFailed message={state.message} onRetry={handlers.onRetry} />}
      {state.kind === "ready" && isOpen(state) && <RegionsPanel state={state} handlers={handlers} />}
    </section>
  );
}
