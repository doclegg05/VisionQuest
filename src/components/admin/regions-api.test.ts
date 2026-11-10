import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignCoordinator,
  createRegion,
  loadRegions,
  removeCoordinator,
  renameRegion,
  setRegionStatus,
  type RegionsHttp,
} from "./regions-api";

interface Call {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
}

/** A stand-in for the app's `api` client: it records each call, then answers or throws. */
function fakeHttp(answer: () => unknown): RegionsHttp & { calls: Call[] } {
  const calls: Call[] = [];
  const respond = async (call: Call): Promise<unknown> => {
    calls.push(call);
    return answer();
  };
  return {
    calls,
    get: (url) => respond({ method: "GET", url }),
    post: (url, body) => respond({ method: "POST", url, body }),
    patch: (url, body) => respond({ method: "PATCH", url, body }),
    del: (url) => respond({ method: "DELETE", url }),
  };
}

function failing(error: unknown): () => never {
  return () => {
    throw error;
  };
}

const north = { id: "r1", name: "North", code: "north", status: "active", classCount: 1, coordinators: [] };

describe("loadRegions", () => {
  it("returns the regions the server lists", async () => {
    const http = fakeHttp(() => ({ regions: [north] }));
    const outcome = await loadRegions(http);
    assert.deepEqual(outcome, { ok: true, value: [north] });
    assert.deepEqual(http.calls, [{ method: "GET", url: "/api/admin/regions" }]);
  });

  it("returns an empty list when there are no regions", async () => {
    assert.deepEqual(await loadRegions(fakeHttp(() => ({ regions: [] }))), { ok: true, value: [] });
  });

  it("passes the server's own message on when the load fails", async () => {
    const outcome = await loadRegions(fakeHttp(failing(new Error("Admin access required."))));
    assert.deepEqual(outcome, { ok: false, message: "Admin access required." });
  });

  it("says so in plain words when the failure carries no message", async () => {
    const outcome = await loadRegions(fakeHttp(failing("boom")));
    assert.deepEqual(outcome, { ok: false, message: "We could not load the regions. Please try again." });
  });

  it("fails when the reply is not a list of regions", async () => {
    const outcome = await loadRegions(fakeHttp(() => ({ regions: "none" })));
    assert.deepEqual(outcome, { ok: false, message: "We could not read the list of regions. Please try again." });
  });
});

describe("createRegion", () => {
  it("sends the trimmed name and a lower-case code, and returns the new region", async () => {
    const http = fakeHttp(() => ({ region: { id: "r2", name: "East Side", code: "east-side", status: "active" } }));
    const outcome = await createRegion(http, { name: "  East Side ", code: "East-Side" });
    assert.deepEqual(http.calls, [
      { method: "POST", url: "/api/admin/regions", body: { name: "East Side", code: "east-side" } },
    ]);
    assert.deepEqual(outcome, {
      ok: true,
      value: { id: "r2", name: "East Side", code: "east-side", status: "active", classCount: 0, coordinators: [] },
    });
  });

  it("passes the server's own message on when the save fails", async () => {
    const http = fakeHttp(failing(new Error("That region code is already in use.")));
    const outcome = await createRegion(http, { name: "East", code: "east" });
    assert.deepEqual(outcome, { ok: false, message: "That region code is already in use." });
  });

  it("does not send a name that is only spaces", async () => {
    const http = fakeHttp(() => ({}));
    const outcome = await createRegion(http, { name: "   ", code: "east" });
    assert.deepEqual(outcome, { ok: false, message: "Type a name for the region." });
    assert.deepEqual(http.calls, []);
  });

  it("does not send a code the server would refuse", async () => {
    const http = fakeHttp(() => ({}));
    const outcome = await createRegion(http, { name: "East", code: "east side!" });
    assert.deepEqual(outcome, { ok: false, message: "Use only letters, numbers and dashes in the short code." });
    assert.deepEqual(http.calls, []);
  });

  it("says the region was saved when the reply cannot be read", async () => {
    const outcome = await createRegion(fakeHttp(() => ({ ok: true })), { name: "East", code: "east" });
    assert.deepEqual(outcome, {
      ok: false,
      message: "The region was saved, but we could not show it. Reload the page to see it.",
    });
  });
});

describe("renameRegion", () => {
  it("sends the new name and returns the name the server kept", async () => {
    const http = fakeHttp(() => ({ region: { id: "r1", name: "Northern", code: "north", status: "active" } }));
    const outcome = await renameRegion(http, "r1", " Northern ");
    assert.deepEqual(http.calls, [{ method: "PATCH", url: "/api/admin/regions/r1", body: { name: "Northern" } }]);
    assert.deepEqual(outcome, { ok: true, value: "Northern" });
  });

  it("does not send a name that is only spaces", async () => {
    const http = fakeHttp(() => ({}));
    assert.deepEqual(await renameRegion(http, "r1", "  "), { ok: false, message: "Type a name for the region." });
    assert.deepEqual(http.calls, []);
  });

  it("passes the server's own message on when the save fails", async () => {
    const outcome = await renameRegion(fakeHttp(failing(new Error("Region not found."))), "r1", "Northern");
    assert.deepEqual(outcome, { ok: false, message: "Region not found." });
  });
});

describe("setRegionStatus", () => {
  it("archives a region", async () => {
    const http = fakeHttp(() => ({ region: { id: "r1", name: "North", code: "north", status: "archived" } }));
    const outcome = await setRegionStatus(http, "r1", "archived");
    assert.deepEqual(http.calls, [{ method: "PATCH", url: "/api/admin/regions/r1", body: { status: "archived" } }]);
    assert.deepEqual(outcome, { ok: true, value: "archived" });
  });

  it("passes the server's own message on when the save fails", async () => {
    const outcome = await setRegionStatus(fakeHttp(failing(new Error("Region not found."))), "r1", "active");
    assert.deepEqual(outcome, { ok: false, message: "Region not found." });
  });
});

describe("coordinators", () => {
  it("assigns a coordinator to a region", async () => {
    const http = fakeHttp(() => ({ assignment: { regionId: "r1", coordinatorId: "u1" } }));
    const outcome = await assignCoordinator(http, "r1", "u1");
    assert.deepEqual(http.calls, [
      { method: "POST", url: "/api/admin/regions/r1/coordinators", body: { coordinatorId: "u1" } },
    ]);
    assert.deepEqual(outcome, { ok: true, value: null });
  });

  it("passes the server's own message on when the assignment is refused", async () => {
    const http = fakeHttp(failing(new Error("Coordinator is already assigned to this region.")));
    assert.deepEqual(await assignCoordinator(http, "r1", "u1"), {
      ok: false,
      message: "Coordinator is already assigned to this region.",
    });
  });

  it("removes a coordinator from a region", async () => {
    const http = fakeHttp(() => ({ success: true }));
    const outcome = await removeCoordinator(http, "r1", "u1");
    assert.deepEqual(http.calls, [{ method: "DELETE", url: "/api/admin/regions/r1/coordinators/u1" }]);
    assert.deepEqual(outcome, { ok: true, value: null });
  });

  it("passes the server's own message on when the removal fails", async () => {
    const outcome = await removeCoordinator(fakeHttp(failing(new Error("Assignment not found."))), "r1", "u1");
    assert.deepEqual(outcome, { ok: false, message: "Assignment not found." });
  });

  it("escapes ids before they go into a path", async () => {
    const http = fakeHttp(() => ({ success: true }));
    await removeCoordinator(http, "r/1", "u?1");
    assert.equal(http.calls[0].url, "/api/admin/regions/r%2F1/coordinators/u%3F1");
  });
});
