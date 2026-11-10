import {
  applyRegionChange,
  mergePeople,
  type AdminRegion,
  type RegionListChange,
  type RegionPerson,
} from "./regions-model";

/** The control a request belongs to: the add form, or one region's row. */
export type SaveTarget = { kind: "create" } | { kind: "region"; regionId: string };

export interface SaveFailure {
  target: SaveTarget;
  message: string;
}

export interface ReadyState {
  kind: "ready";
  regions: readonly AdminRegion[];
  /** Everyone seen holding a region since the page loaded. */
  people: readonly RegionPerson[];
  open: boolean;
  /** One request at a time: while this is set, every control that saves is disabled. */
  busy: SaveTarget | null;
  failure: SaveFailure | null;
  notice: string;
}

export type RegionsState = { kind: "loading" } | { kind: "load-failed"; message: string } | ReadyState;

export type RegionsAction =
  | { type: "load-started" }
  | { type: "load-succeeded"; regions: readonly AdminRegion[] }
  | { type: "load-failed"; message: string }
  | { type: "toggled" }
  | { type: "save-started"; target: SaveTarget }
  | { type: "save-succeeded"; change: RegionListChange; notice: string }
  | { type: "save-failed"; target: SaveTarget; message: string };

export const INITIAL_REGIONS_STATE: RegionsState = { kind: "loading" };

/** With no region the card opens on its own: adding one is the admin's first step. */
function loaded(regions: readonly AdminRegion[]): ReadyState {
  return {
    kind: "ready",
    regions,
    people: mergePeople([], regions),
    open: regions.length === 0,
    busy: null,
    failure: null,
    notice: "",
  };
}

function whenReady(state: RegionsState, change: (ready: ReadyState) => ReadyState): RegionsState {
  return state.kind === "ready" ? change(state) : state;
}

/** The list after a saved change. People seen before stay on offer. */
function saved(ready: ReadyState, change: RegionListChange, notice: string): ReadyState {
  const regions = applyRegionChange(ready.regions, change);
  return { ...ready, regions, people: mergePeople(ready.people, regions), busy: null, failure: null, notice };
}

export function regionsReducer(state: RegionsState, action: RegionsAction): RegionsState {
  switch (action.type) {
    case "load-started":
      return { kind: "loading" };
    case "load-succeeded":
      return loaded(action.regions);
    case "load-failed":
      return { kind: "load-failed", message: action.message };
    case "toggled":
      return whenReady(state, (ready) => ({ ...ready, open: !ready.open }));
    case "save-started":
      return whenReady(state, (ready) => ({ ...ready, busy: action.target, failure: null, notice: "" }));
    case "save-succeeded":
      return whenReady(state, (ready) => saved(ready, action.change, action.notice));
    case "save-failed":
      return whenReady(state, (ready) => ({
        ...ready,
        busy: null,
        failure: { target: action.target, message: action.message },
      }));
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function sameTarget(a: SaveTarget, b: SaveTarget): boolean {
  if (a.kind === "create") return b.kind === "create";
  return b.kind === "region" && a.regionId === b.regionId;
}

/** The failed save's message, for the control it belongs to and no other. */
export function failureFor(state: ReadyState, target: SaveTarget): string | null {
  return state.failure && sameTarget(state.failure.target, target) ? state.failure.message : null;
}
