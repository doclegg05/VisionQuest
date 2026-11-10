import type { RegionsHandlers } from "./RegionsCardView";
import type { RemoveCoordinatorRequest } from "./RegionRows";
import {
  assignCoordinator,
  createRegion,
  loadRegions,
  removeCoordinator,
  renameRegion,
  setRegionStatus,
  type NewRegionInput,
  type Outcome,
  type RegionsHttp,
} from "./regions-api";
import { REGION_NOTICES, archiveConfirm, removeCoordinatorConfirm, type ConfirmCopy } from "./regions-copy";
import type { AdminRegion, RegionListChange, RegionPerson, RegionStatus } from "./regions-model";
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
  onArchive: (region: AdminRegion) => Promise<void>;
  onRestore: (region: AdminRegion) => Promise<void>;
  onRemove: (request: RemoveCoordinatorRequest) => Promise<void>;
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
        dispatch({ type: "save-failed", target, message: outcome.message });
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

function regionHandlers({ http, confirm }: RegionsControllerDeps, save: Save) {
  const setStatus = (region: AdminRegion, status: RegionStatus): Promise<boolean> =>
    save(rowOf(region), () => setRegionStatus(http, region.id, status), (saved) => ({
      change: { kind: "region-changed", regionId: region.id, change: { status: saved } },
      notice: saved === "archived" ? REGION_NOTICES.archived(region.name) : REGION_NOTICES.restored(region.name),
    }));
  return {
    onCreate: (input: NewRegionInput) =>
      save({ kind: "create" }, () => createRegion(http, input), (region) => ({
        change: { kind: "region-added", region },
        notice: REGION_NOTICES.added(region.name),
      })),
    onRename: (region: AdminRegion, name: string) =>
      save(rowOf(region), () => renameRegion(http, region.id, name), (saved) => ({
        change: { kind: "region-changed", regionId: region.id, change: { name: saved } },
        notice: REGION_NOTICES.renamed(saved),
      })),
    onArchive: async (region: AdminRegion) => {
      if (await confirm(archiveConfirm(region))) await setStatus(region, "archived");
    },
    onRestore: async (region: AdminRegion) => {
      await setStatus(region, "active");
    },
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
      if (!(await confirm(copy))) return;
      await save(rowOf(region), () => removeCoordinator(http, region.id, person.id), () => ({
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
    const outcome = await loadRegions(http);
    dispatch(
      outcome.ok
        ? { type: "load-succeeded", regions: outcome.value }
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
