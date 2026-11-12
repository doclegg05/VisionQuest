import assert from "node:assert/strict";
import { ApiClientError } from "@/lib/api";
import { describe, it } from "node:test";

import {
  assignCoordinator,
  createRegion,
  loadRegions,
  removeCoordinator,
  renameRegion,
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

  it("shows plain words, not the server's, when the load fails", async () => {
    const outcome = await loadRegions(fakeHttp(failing(new ApiClientError(403, "Admin access required."))));
    assert.deepEqual(outcome, { ok: false, message: "We could not load the regions. Please try again." });
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

  it("names the short code that is taken, and marks the code as the problem", async () => {
    const http = fakeHttp(failing(new ApiClientError(409, "That region code is already in use.")));
    const outcome = await createRegion(http, { name: "East", code: "East" });
    assert.deepEqual(outcome, {
      ok: false,
      message: 'Another region already uses the short code "east". Change the short code and try again.',
      problem: "code-taken",
    });
  });

  it("shows plain words, not the server's, for any other failure", async () => {
    const http = fakeHttp(failing(new ApiClientError(400, "Code must be alphanumeric (dashes allowed).")));
    const outcome = await createRegion(http, { name: "East", code: "east" });
    assert.deepEqual(outcome, { ok: false, message: "We could not save that. Please try again." });
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

  it("says the region changed somewhere else when the server cannot find it", async () => {
    const outcome = await renameRegion(fakeHttp(failing(new ApiClientError(404, "Region not found."))), "r1", "Northern");
    assert.deepEqual(outcome, { ok: false, message: "This region was changed somewhere else. Reload the page." });
  });
});

describe("coordinator changes made somewhere else", () => {
  it("reads an assignment that already exists as a change made somewhere else", async () => {
    const http = fakeHttp(failing(new ApiClientError(409, "Coordinator is already assigned to this region.")));
    assert.deepEqual(await assignCoordinator(http, "r1", "u1"), {
      ok: false,
      message: "This region was changed somewhere else. Reload the page.",
    });
  });

  it("reads an assignment that is already gone the same way", async () => {
    const http = fakeHttp(failing(new ApiClientError(404, "Assignment not found.")));
    assert.deepEqual(await removeCoordinator(http, "r1", "u1"), {
      ok: false,
      message: "This region was changed somewhere else. Reload the page.",
    });
  });
});

describe("archive and restore", () => {
  it("are not offered: this screen sends no status change", async () => {
    const api = await import("./regions-api");
    assert.equal("setRegionStatus" in api, false);
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

  it("shows plain words when the assignment fails for another reason", async () => {
    const http = fakeHttp(failing(new Error("connection reset")));
    assert.deepEqual(await assignCoordinator(http, "r1", "u1"), {
      ok: false,
      message: "We could not save that. Please try again.",
    });
  });

  it("removes a coordinator from a region", async () => {
    const http = fakeHttp(() => ({ success: true }));
    const outcome = await removeCoordinator(http, "r1", "u1");
    assert.deepEqual(http.calls, [{ method: "DELETE", url: "/api/admin/regions/r1/coordinators/u1" }]);
    assert.deepEqual(outcome, { ok: true, value: null });
  });

  it("shows plain words when the removal fails for another reason", async () => {
    const outcome = await removeCoordinator(fakeHttp(failing(new ApiClientError(500, "boom"))), "r1", "u1");
    assert.deepEqual(outcome, { ok: false, message: "We could not save that. Please try again." });
  });

  it("escapes ids before they go into a path", async () => {
    const http = fakeHttp(() => ({ success: true }));
    await removeCoordinator(http, "r/1", "u?1");
    assert.equal(http.calls[0].url, "/api/admin/regions/r%2F1/coordinators/u%3F1");
  });
});
