import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdminRegion, RegionPerson } from "./regions-model";
import {
  INITIAL_REGIONS_STATE,
  failureFor,
  regionsReducer,
  type ReadyState,
  type RegionsAction,
  type RegionsState,
} from "./regions-reducer";

const pat: RegionPerson = { id: "u1", displayName: "Pat Lee", email: null };

function region(overrides: Partial<AdminRegion> = {}): AdminRegion {
  return { id: "r1", name: "North", code: "north", status: "active", classCount: 0, coordinators: [], ...overrides };
}

function run(actions: readonly RegionsAction[], start: RegionsState = INITIAL_REGIONS_STATE): RegionsState {
  return actions.reduce(regionsReducer, start);
}

function ready(state: RegionsState): ReadyState {
  assert.equal(state.kind, "ready");
  if (state.kind !== "ready") throw new Error("expected the ready state");
  return state;
}

describe("loading the regions", () => {
  it("starts out loading", () => {
    assert.deepEqual(INITIAL_REGIONS_STATE, { kind: "loading" });
  });

  it("opens the card when the system has no regions, so the first step is in view", () => {
    const state = ready(run([{ type: "load-succeeded", regions: [] }]));
    assert.deepEqual(state.regions, []);
    assert.equal(state.open, true);
  });

  it("keeps the card closed when regions already exist", () => {
    const state = ready(run([{ type: "load-succeeded", regions: [region()] }]));
    assert.equal(state.open, false);
    assert.equal(state.busy, null);
    assert.equal(state.failure, null);
  });

  it("keeps the server's message when the load fails", () => {
    const state = run([{ type: "load-failed", message: "Admin access required." }]);
    assert.deepEqual(state, { kind: "load-failed", message: "Admin access required." });
  });

  it("goes back to loading when the admin tries again", () => {
    const state = run([{ type: "load-failed", message: "x" }, { type: "load-started" }]);
    assert.deepEqual(state, { kind: "loading" });
  });

  it("remembers who holds a region", () => {
    const state = ready(run([{ type: "load-succeeded", regions: [region({ coordinators: [pat] })] }]));
    assert.deepEqual(state.people, [pat]);
  });
});

describe("opening and closing the card", () => {
  it("flips open and closed", () => {
    const loaded: RegionsAction = { type: "load-succeeded", regions: [region()] };
    assert.equal(ready(run([loaded, { type: "toggled" }])).open, true);
    assert.equal(ready(run([loaded, { type: "toggled" }, { type: "toggled" }])).open, false);
  });

  it("does nothing before the list has loaded", () => {
    assert.deepEqual(run([{ type: "toggled" }]), { kind: "loading" });
  });
});

describe("saving a change", () => {
  const loaded: RegionsAction = { type: "load-succeeded", regions: [] };

  it("marks the request in flight and clears the last result", () => {
    const state = ready(
      run([
        loaded,
        { type: "save-failed", target: { kind: "create" }, message: "old" },
        { type: "save-started", target: { kind: "region", regionId: "r1" } },
      ]),
    );
    assert.deepEqual(state.busy, { kind: "region", regionId: "r1" });
    assert.equal(state.failure, null);
    assert.equal(state.notice, "");
  });

  it("shows the new list and a notice when the save works", () => {
    const state = ready(
      run([
        loaded,
        { type: "save-started", target: { kind: "create" } },
        { type: "save-succeeded", change: { kind: "region-added", region: region() }, notice: "North was added." },
      ]),
    );
    assert.deepEqual(state.regions, [region()]);
    assert.equal(state.notice, "North was added.");
    assert.equal(state.busy, null);
  });

  it("stays open after the first region is added", () => {
    const state = ready(run([loaded, { type: "save-succeeded", change: { kind: "region-added", region: region() }, notice: "" }]));
    assert.equal(state.open, true);
  });

  it("keeps the list and shows the server's message when the save fails", () => {
    const state = ready(
      run([
        { type: "load-succeeded", regions: [region()] },
        { type: "save-started", target: { kind: "create" } },
        { type: "save-failed", target: { kind: "create" }, message: "That region code is already in use." },
      ]),
    );
    assert.deepEqual(state.regions, [region()]);
    assert.equal(state.busy, null);
    assert.deepEqual(state.failure, { target: { kind: "create" }, message: "That region code is already in use." });
  });

  it("keeps a coordinator on offer after they are removed from their last region", () => {
    const state = ready(
      run([
        { type: "load-succeeded", regions: [region({ coordinators: [pat] })] },
        { type: "save-succeeded", change: { kind: "coordinator-removed", regionId: "r1", coordinatorId: "u1" }, notice: "" },
      ]),
    );
    assert.deepEqual(state.regions[0].coordinators, []);
    assert.deepEqual(state.people, [pat]);
  });

  it("ignores a save result that arrives before the list has loaded", () => {
    const state = run([{ type: "save-succeeded", change: { kind: "region-added", region: region() }, notice: "x" }]);
    assert.deepEqual(state, { kind: "loading" });
  });
});

describe("failureFor", () => {
  const failed = ready(
    run([
      { type: "load-succeeded", regions: [region()] },
      { type: "save-failed", target: { kind: "region", regionId: "r1" }, message: "Region not found." },
    ]),
  );

  it("gives the message to the control that failed", () => {
    assert.equal(failureFor(failed, { kind: "region", regionId: "r1" }), "Region not found.");
  });

  it("gives nothing to any other control", () => {
    assert.equal(failureFor(failed, { kind: "region", regionId: "r2" }), null);
    assert.equal(failureFor(failed, { kind: "create" }), null);
  });
});
