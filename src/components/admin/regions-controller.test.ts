import assert from "node:assert/strict";
import { ApiClientError } from "@/lib/api";
import { describe, it } from "node:test";

import type { RegionsHttp } from "./regions-api";
import { createRegionsController } from "./regions-controller";
import type { ConfirmCopy } from "./regions-copy";
import type { AdminRegion, RegionPerson } from "./regions-model";
import { INITIAL_REGIONS_STATE, regionsReducer, type RegionsAction, type RegionsState } from "./regions-reducer";

const pat: RegionPerson = { id: "u1", displayName: "Pat Lee", email: null };
const north: AdminRegion = { id: "r1", name: "North", code: "north", status: "active", classCount: 2, coordinators: [pat] };
const east: AdminRegion = { id: "r2", name: "East", code: "east", status: "active", classCount: 0, coordinators: [] };

interface Harness {
  controller: ReturnType<typeof createRegionsController>;
  actions: RegionsAction[];
  requests: string[];
  confirms: ConfirmCopy[];
  state: () => RegionsState;
  refreshes: () => number;
}

interface HarnessOptions {
  /** Answers each request, or throws to fail it. */
  answer?: (request: string) => unknown;
  confirmWith?: boolean;
  regions?: readonly AdminRegion[];
}

/** The controller wired to the real reducer and a stand-in for the server. */
function harness(options: HarnessOptions = {}): Harness {
  const actions: RegionsAction[] = [];
  const requests: string[] = [];
  const confirms: ConfirmCopy[] = [];
  let refreshes = 0;
  let state: RegionsState = options.regions
    ? regionsReducer(INITIAL_REGIONS_STATE, { type: "load-succeeded", regions: options.regions })
    : INITIAL_REGIONS_STATE;
  const respond = async (request: string): Promise<unknown> => {
    requests.push(request);
    return options.answer ? options.answer(request) : {};
  };
  const http: RegionsHttp = {
    get: (url) => respond(`GET ${url}`),
    post: (url, body) => respond(`POST ${url} ${JSON.stringify(body)}`),
    patch: (url, body) => respond(`PATCH ${url} ${JSON.stringify(body)}`),
    del: (url) => respond(`DELETE ${url}`),
  };
  const controller = createRegionsController({
    http,
    dispatch: (action) => {
      actions.push(action);
      state = regionsReducer(state, action);
    },
    confirm: async (copy) => {
      confirms.push(copy);
      return options.confirmWith ?? true;
    },
    onSaved: () => {
      refreshes += 1;
    },
  });
  return { controller, actions, requests, confirms, state: () => state, refreshes: () => refreshes };
}

function failWith(status: number, message: string): () => never {
  return () => {
    throw new ApiClientError(status, message);
  };
}

function regionsOf(state: RegionsState): readonly AdminRegion[] {
  assert.equal(state.kind, "ready");
  return state.kind === "ready" ? state.regions : [];
}

describe("loading", () => {
  it("shows the regions the server lists", async () => {
    const h = harness({ answer: () => ({ regions: [north] }) });
    await h.controller.load();
    assert.deepEqual(regionsOf(h.state()), [north]);
  });

  it("shows the empty state when there are no regions", async () => {
    const h = harness({ answer: () => ({ regions: [] }) });
    await h.controller.load();
    assert.deepEqual(h.actions, [{ type: "load-succeeded", regions: [], people: [] }]);
  });

  it("shows the server's message when the load fails", async () => {
    const h = harness({ answer: failWith(403, "Admin access required.") });
    await h.controller.load();
    assert.deepEqual(h.state(), { kind: "load-failed", message: "We could not load the regions. Please try again." });
  });

  it("goes back to loading, then loads, when the admin tries again", async () => {
    const h = harness({ answer: () => ({ regions: [north] }) });
    h.controller.onRetry();
    assert.deepEqual(h.state(), { kind: "loading" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(regionsOf(h.state()), [north]);
  });
});

describe("adding a region", () => {
  const created = { region: { id: "r2", name: "East", code: "east", status: "active" } };

  it("adds the region to the list, says so, and refreshes the page", async () => {
    const h = harness({ regions: [], answer: () => created });
    const saved = await h.controller.onCreate({ name: "East", code: "east" });
    assert.equal(saved, true);
    assert.deepEqual(h.actions.map((action) => action.type), ["save-started", "save-succeeded"]);
    assert.deepEqual(regionsOf(h.state()), [east]);
    const state = h.state();
    assert.equal(state.kind === "ready" && state.notice, "East was added.");
    assert.equal(h.refreshes(), 1);
  });

  it("says the short code is taken, marks the code, and leaves the list alone", async () => {
    const h = harness({ regions: [north], answer: failWith(409, "That region code is already in use.") });
    const saved = await h.controller.onCreate({ name: "North", code: "north" });
    assert.equal(saved, false);
    assert.deepEqual(h.actions.at(-1), {
      type: "save-failed",
      target: { kind: "create" },
      message: 'Another region already uses the short code "north". Change the short code and try again.',
      problem: "code-taken",
    });
    assert.deepEqual(regionsOf(h.state()), [north]);
    assert.equal(h.refreshes(), 0);
  });

  it("sends one request when the button is pressed twice", async () => {
    const h = harness({ regions: [], answer: () => created });
    const [first, second] = await Promise.all([
      h.controller.onCreate({ name: "East", code: "east" }),
      h.controller.onCreate({ name: "East", code: "east" }),
    ]);
    assert.deepEqual([first, second], [true, false]);
    assert.equal(h.requests.length, 1);
  });

  it("can save again after a save has finished", async () => {
    const h = harness({ regions: [], answer: failWith(500, "Try later.") });
    await h.controller.onCreate({ name: "East", code: "east" });
    await h.controller.onCreate({ name: "East", code: "east" });
    assert.equal(h.requests.length, 2);
  });
});

describe("renaming a region", () => {
  it("shows the name the server kept", async () => {
    const h = harness({
      regions: [north],
      answer: () => ({ region: { id: "r1", name: "Northern", code: "north", status: "active" } }),
    });
    assert.equal(await h.controller.onRename(north, " Northern "), true);
    assert.deepEqual(regionsOf(h.state()).map((region) => region.name), ["Northern"]);
    assert.deepEqual(h.requests, ['PATCH /api/admin/regions/r1 {"name":"Northern"}']);
  });

  it("puts the failure on that region's rename form", async () => {
    const h = harness({ regions: [north], answer: failWith(404, "Region not found.") });
    assert.equal(await h.controller.onRename(north, "Northern"), false);
    assert.deepEqual(h.actions.at(-1), {
      type: "save-failed",
      target: { kind: "rename", regionId: "r1" },
      message: "This region was changed somewhere else. Reload the page.",
    });
  });
});

describe("archive and restore", () => {
  it("are not offered: the controller has no handler for either", () => {
    const h = harness({ regions: [north] });
    assert.equal("onArchive" in h.controller, false);
    assert.equal("onRestore" in h.controller, false);
  });
});

describe("coordinators", () => {
  it("offers a coordinator with no region after a fresh page load", async () => {
    const h = harness({ answer: () => ({ regions: [east], coordinatorChoices: [pat] }) });
    await h.controller.load();
    const state = h.state();
    assert.equal(state.kind, "ready");
    if (state.kind !== "ready") return;
    assert.deepEqual(state.people, [pat]);
    assert.equal(await h.controller.onAssign(east, state.people[0]), true);
    assert.deepEqual(regionsOf(h.state())[0].coordinators, [pat]);
  });
  it("adds a coordinator to the region", async () => {
    const h = harness({ regions: [north, east] });
    assert.equal(await h.controller.onAssign(east, pat), true);
    assert.deepEqual(h.requests, ['POST /api/admin/regions/r2/coordinators {"coordinatorId":"u1"}']);
    assert.deepEqual(regionsOf(h.state()).find((region) => region.id === "r2")?.coordinators, [pat]);
  });

  it("warns before removing a coordinator from their only region", async () => {
    const h = harness({ regions: [north, east] });
    await h.controller.onRemove({ region: north, person: pat, onlyRegion: true });
    assert.equal(h.confirms[0].title, "Remove Pat Lee from North?");
    assert.match(h.confirms[0].message, /only region/);
  });

  it("does not warn when the coordinator keeps another region", async () => {
    const h = harness({ regions: [north, { ...east, coordinators: [pat] }] });
    await h.controller.onRemove({ region: north, person: pat, onlyRegion: false });
    assert.doesNotMatch(h.confirms[0].message, /only region/);
  });

  it("sends nothing when the admin cancels the removal, and says nothing was removed", async () => {
    const h = harness({ regions: [north], confirmWith: false });
    assert.equal(await h.controller.onRemove({ region: north, person: pat, onlyRegion: true }), false);
    assert.deepEqual(h.requests, []);
  });

  it("resolves true once the coordinator is removed, so the row can move focus", async () => {
    const h = harness({ regions: [north] });
    assert.equal(await h.controller.onRemove({ region: north, person: pat, onlyRegion: true }), true);
  });

  it("removes the coordinator but keeps them on offer", async () => {
    const h = harness({ regions: [north] });
    await h.controller.onRemove({ region: north, person: pat, onlyRegion: true });
    assert.deepEqual(h.requests, ["DELETE /api/admin/regions/r1/coordinators/u1"]);
    const state = h.state();
    assert.equal(state.kind, "ready");
    if (state.kind !== "ready") return;
    assert.deepEqual(state.regions[0].coordinators, []);
    assert.deepEqual(state.people, [pat]);
  });
});

describe("opening the card", () => {
  it("flips the card open", () => {
    const h = harness({ regions: [north] });
    h.controller.onToggle();
    assert.deepEqual(h.actions, [{ type: "toggled" }]);
  });
});
