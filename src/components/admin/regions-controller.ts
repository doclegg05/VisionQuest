import type { RegionsHandlers } from "./RegionsCardView";
import type { RemoveCoordinatorRequest } from "./RegionRows";
import {
  assignCoordinator,
  createRegion,
  loadRegions,
  removeCoordinator,
  renameRegion,
  type NewRegionInput,
  type Outcome,
  type RegionsHttp,
} from "./regions-api";
import { REGION_NOTICES, removeCoordinatorConfirm, type ConfirmCopy } from "./regions-copy";
import type { AdminRegion, RegionListChange, RegionPerson } from "./regions-model";
import type { RegionsAction, SaveTarget } from "./regions-reducer";

export interface RegionsControllerDeps {
  http: RegionsHttp;
  dispatch: (action: RegionsAction) => void;
  confirm: (copy: ConfirmCopy) => Promise<boolean>;
  /** Called after each saved change, so the rest of the page can catch up. */
  onSaved: () => void;
}

/** The card's handlers. The ones that ask first resolve when the whole step is done. */
export interface RegionsController extends RegionsHandlers {
  load: () => Promise<void>;
  /** Resolves true once the coordinator is removed, false when cancelled or failed. */
  onRemove: (request: RemoveCoordinatorRequest) => Promise<boolean>;
}

/** What a saved change leaves behind: the change to the list and the words that announce it. */
interface Saved {
  change: RegionListChange;
  notice: string;
}

type Save = <T>(target: SaveTarget, request: () => Promise<Outcome<T>>, describe: (value: T) => Saved) => Promise<boolean>;

function rowOf(region: AdminRegion): SaveTarget {
  return { kind: "region", regionId: region.id };
}

/**
 * One save at a time. The flag is set before the first await, so a second
 * press that lands before React redraws the disabled button sends nothing.
 */
function createSave({ dispatch, onSaved }: RegionsControllerDeps): Save {
  let inFlight = false;
  return async (target, request, describe) => {
    if (inFlight) return false;
    inFlight = true;
    dispatch({ type: "save-started", target });
    try {
      const outcome = await request();
      if (!outcome.ok) {
        const { message, problem } = outcome;
        dispatch({ type: "save-failed", target, message, ...(problem ? { problem } : {}) });
        return false;
      }
      dispatch({ type: "save-succeeded", ...describe(outcome.value) });
      onSaved();
      return true;
    } finally {
      inFlight = false;
    }
  };
}

function regionHandlers({ http }: RegionsControllerDeps, save: Save) {
  return {
    onCreate: (input: NewRegionInput) =>
      save({ kind: "create" }, () => createRegion(http, input), (region) => ({
        change: { kind: "region-added", region },
        notice: REGION_NOTICES.added(region.name),
      })),
    onRename: (region: AdminRegion, name: string) =>
      save({ kind: "rename", regionId: region.id }, () => renameRegion(http, region.id, name), (saved) => ({
        change: { kind: "region-changed", regionId: region.id, change: { name: saved } },
        notice: REGION_NOTICES.renamed(saved),
      })),
  };
}

function coordinatorHandlers({ http, confirm }: RegionsControllerDeps, save: Save) {
  return {
    onAssign: (region: AdminRegion, person: RegionPerson) =>
      save(rowOf(region), () => assignCoordinator(http, region.id, person.id), () => ({
        change: { kind: "coordinator-added", regionId: region.id, person },
        notice: REGION_NOTICES.coordinatorAdded(person.displayName, region.name),
      })),
    onRemove: async ({ region, person, onlyRegion }: RemoveCoordinatorRequest) => {
      const copy = removeCoordinatorConfirm({ personName: person.displayName, regionName: region.name, onlyRegion });
      if (!(await confirm(copy))) return false;
      return save(rowOf(region), () => removeCoordinator(http, region.id, person.id), () => ({
        change: { kind: "coordinator-removed", regionId: region.id, coordinatorId: person.id },
        notice: REGION_NOTICES.coordinatorRemoved(person.displayName, region.name),
      }));
    },
  };
}

/** Everything the Regions card does, with no React in it, so a test can drive it. */
export function createRegionsController(deps: RegionsControllerDeps): RegionsController {
  const { http, dispatch } = deps;
  const save = createSave(deps);
  const load = async (): Promise<void> => {
    let people: RegionPerson[] = [];
    const outcome = await loadRegions(http, (choices) => { people = choices; });
    dispatch(
      outcome.ok
        ? { type: "load-succeeded", regions: outcome.value, people }
        : { type: "load-failed", message: outcome.message },
    );
  };
  return {
    load,
    onRetry: () => {
      dispatch({ type: "load-started" });
      void load();
    },
    onToggle: () => dispatch({ type: "toggled" }),
    ...regionHandlers(deps, save),
    ...coordinatorHandlers(deps, save),
  };
}
