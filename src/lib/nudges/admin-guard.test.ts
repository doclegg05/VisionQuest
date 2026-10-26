import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const state = {
  rows: [{ rolbypassrls: true }] as Array<{ rolbypassrls: boolean }>,
  throws: false,
  queries: 0,
  logs: [] as string[],
};

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      $queryRaw: async () => {
        state.queries += 1;
        if (state.throws) throw new Error("connection refused");
        return state.rows;
      },
    },
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: (message: string) => state.logs.push(message),
    },
  },
});

let guard: typeof import("./admin-guard");

before(async () => {
  guard = await import("./admin-guard");
});

beforeEach(() => {
  state.rows = [{ rolbypassrls: true }];
  state.throws = false;
  state.queries = 0;
  state.logs = [];
  guard.resetAdminClientProbe();
});

describe("adminClientIsPrivileged (F63)", () => {
  it("asks Postgres what the connection can actually do", async () => {
    assert.equal(await guard.adminClientIsPrivileged(), true);
    assert.equal(state.queries, 1);
  });

  it("says no, loudly, when the client is really vq_app", async () => {
    // The whole failure mode: ADMIN_DATABASE_URL unset, prismaAdmin silently
    // becomes the app client, every cross-student read returns nothing, and
    // the feature goes quiet looking exactly like "nothing was due".
    state.rows = [{ rolbypassrls: false }];
    assert.equal(await guard.adminClientIsPrivileged(), false);
    assert.ok(
      state.logs.includes("nudges_admin_client_missing"),
      `expected the named alarm, got: ${state.logs.join(", ")}`,
    );
  });

  it("caches the answer, because it cannot change without a redeploy", async () => {
    await guard.adminClientIsPrivileged();
    await guard.adminClientIsPrivileged();
    await guard.adminClientIsPrivileged();
    assert.equal(state.queries, 1);
  });

  it("does NOT cache a failure — a blip must not disable the feature until deploy", async () => {
    state.throws = true;
    assert.equal(await guard.adminClientIsPrivileged(), false);
    assert.ok(state.logs.includes("nudges_admin_client_probe_failed"));

    state.throws = false;
    assert.equal(await guard.adminClientIsPrivileged(), true);
    assert.equal(state.queries, 2, "it asked again");
  });

  it("treats an empty result as not privileged", async () => {
    state.rows = [];
    assert.equal(await guard.adminClientIsPrivileged(), false);
  });
});
