// Tests for the query-count script's options. They never run a measurement.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "query-count.mjs");
const queryCount = () => import("../query-count.mjs");

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

// Counting only the app client once made a move from `prisma` to `prismaAdmin`
// read as 4 round trips saved, while it still cost 1 and skipped row-level security.
test("every measured path counts app and admin round trips by default", async () => {
  const { PATHS, parseArguments } = await queryCount();
  for (const name of Object.keys(PATHS)) {
    assert.equal(parseArguments([name]).client, "all", `${name} must count every client by default`);
  }
});

test("the gate number adds app and admin round trips", async () => {
  const { total } = await queryCount();
  const count = { appRoundTrips: 10, adminRoundTrips: 3, appStatements: 0, adminStatements: 0, app: 0, admin: 0, read: 1 };
  assert.equal(total(count, { client: "all", unit: "round-trips" }), 14);
  assert.equal(total(count, { client: "app", unit: "round-trips" }), 11);
  assert.equal(total(count, { client: "admin", unit: "round-trips" }), 4);
});

test("--client takes app, admin or all", async () => {
  const { parseArguments } = await queryCount();
  for (const client of ["app", "admin", "all"]) {
    assert.equal(parseArguments(["dashboard", `--client=${client}`]).client, client);
  }
});

test("a bare --client exits 2 and names the forms it takes", () => {
  const result = run("dashboard", "--client");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--client needs a value: --client=app, --client=admin or --client=all/);
});

test("the usage text says the default counts every client", () => {
  const result = run("nowhere");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--client=all \(the default\)/);
});

test("the usage text says what 4 per app call assumes, and that every number is a floor", () => {
  const { stderr } = run("nowhere");
  assert.match(stderr, /already prepared/);
  assert.match(stderr, /pgbouncer=true/);
  assert.match(stderr, /floor on wire round trips/);
});

test("reads both chat-send boundaries and says the gate takes the larger", async () => {
  const { parseBoundaries, describeBoundary } = await queryCount();
  const output = [
    "# QUERY_BOUNDARY path=chat-send cache=cold beforeStream=150 beforeProvider=190",
    "# QUERY_BOUNDARY path=chat-send cache=warm beforeStream=127 beforeProvider=127",
    "# QUERY_BOUNDARY path=dashboard cache=cold beforeStream=1 beforeProvider=2",
  ].join("\n");
  const boundaries = parseBoundaries("chat-send", output);
  assert.deepEqual(boundaries.cold, { beforeStream: 150, beforeProvider: 190 });
  assert.equal(
    describeBoundary("cold", boundaries.cold),
    "  cold: before the stream 150, before the provider call 190; the gate reads the larger",
  );
  assert.deepEqual(parseBoundaries("dashboard", "nothing"), {});
});

test("reads the idle rate a rate path prints and totals it by client", async () => {
  const { PATHS, parseRate, rateTotal } = await queryCount();
  assert.equal(PATHS["dashboard-idle"].metric, "M2");
  const output = [
    "# IDLE_RATE path=dashboard-idle windowMs=600000 ticks=20 appPerMinute=70 adminPerMinute=4 perMinute=74",
    "# IDLE_RATE path=elsewhere windowMs=1 ticks=1 appPerMinute=1 adminPerMinute=1 perMinute=2",
  ].join("\n");
  const rate = parseRate("dashboard-idle", output);
  assert.deepEqual(rate, { windowMs: 600000, ticks: 20, app: 70, admin: 4 });
  assert.equal(rateTotal(rate, { client: "all" }), 74);
  assert.equal(rateTotal(rate, { client: "app" }), 70);
  assert.equal(rateTotal(rate, { client: "admin" }), 4);
  assert.equal(parseRate("dashboard-idle", "nothing"), null);
});
