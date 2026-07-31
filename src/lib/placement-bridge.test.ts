import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

// "server-only" throws at import time outside a Next.js server build.
// Everything exercised here is pure, so we stub the module before the
// dynamic import below resolves placement-bridge.ts.
mock.module("server-only", { namedExports: {} });

type PlacementApplicationSignal = import("./placement-bridge").PlacementApplicationSignal;

let buildPlacementAlertDescriptors: typeof import("./placement-bridge").buildPlacementAlertDescriptors;
let buildPlacementSuggestion: typeof import("./placement-bridge").buildPlacementSuggestion;
let evaluatePlacementProvenance: typeof import("./placement-bridge").evaluatePlacementProvenance;
let isPlacementBridgeEnabledForStudent: typeof import("./placement-bridge").isPlacementBridgeEnabledForStudent;
let parsePlacementBridgeScope: typeof import("./placement-bridge").parsePlacementBridgeScope;
let placementAlertKey: typeof import("./placement-bridge").placementAlertKey;
let PLACEMENT_ALERT_TYPE: typeof import("./placement-bridge").PLACEMENT_ALERT_TYPE;

before(async () => {
  const mod = await import("./placement-bridge");
  buildPlacementAlertDescriptors = mod.buildPlacementAlertDescriptors;
  buildPlacementSuggestion = mod.buildPlacementSuggestion;
  evaluatePlacementProvenance = mod.evaluatePlacementProvenance;
  isPlacementBridgeEnabledForStudent = mod.isPlacementBridgeEnabledForStudent;
  parsePlacementBridgeScope = mod.parsePlacementBridgeScope;
  placementAlertKey = mod.placementAlertKey;
  PLACEMENT_ALERT_TYPE = mod.PLACEMENT_ALERT_TYPE;
});

function application(
  overrides: Partial<PlacementApplicationSignal> = {}
): PlacementApplicationSignal {
  return {
    id: "app-1",
    status: "accepted",
    verificationStatus: "verified",
    verifiedAt: new Date("2026-07-29T12:00:00Z"),
    opportunity: { title: "Line Cook", company: "Mountain Diner" },
    ...overrides,
  };
}

const ENABLED = { mode: "all" } as const;
const EMPTY_RECORD = { placementApplicationId: null, unsubsidizedEmploymentAt: null };

// --- flag parsing / scoping -------------------------------------------------

test("scope parsing: unset and empty mean off, 'all' means all, CSV means class pilot", () => {
  assert.deepEqual(parsePlacementBridgeScope(null), { mode: "off" });
  assert.deepEqual(parsePlacementBridgeScope("  "), { mode: "off" });
  assert.deepEqual(parsePlacementBridgeScope(","), { mode: "off" });
  assert.deepEqual(parsePlacementBridgeScope("ALL"), { mode: "all" });
  assert.deepEqual(parsePlacementBridgeScope("class-a, class-b"), {
    mode: "classes",
    classIds: ["class-a", "class-b"],
  });
});

test("class pilot only enables actively enrolled students of listed classes", () => {
  const scope = parsePlacementBridgeScope("class-a");
  assert.equal(isPlacementBridgeEnabledForStudent(scope, ["class-a"]), true);
  assert.equal(isPlacementBridgeEnabledForStudent(scope, ["class-b"]), false);
  assert.equal(isPlacementBridgeEnabledForStudent(scope, []), false);
  assert.equal(isPlacementBridgeEnabledForStudent({ mode: "off" }, ["class-a"]), false);
  assert.equal(isPlacementBridgeEnabledForStudent({ mode: "all" }, []), true);
});

// --- desired-alert builder ---------------------------------------------------

test("flag off produces no queue item even for a verified accepted application", () => {
  const alerts = buildPlacementAlertDescriptors({
    scope: { mode: "off" },
    activeClassIds: [],
    applications: [application()],
    spokesRecord: EMPTY_RECORD,
  });
  assert.deepEqual(alerts, []);
});

test("a verified accepted application raises exactly one stable queue item", () => {
  const build = () =>
    buildPlacementAlertDescriptors({
      scope: ENABLED,
      activeClassIds: [],
      applications: [application()],
      spokesRecord: EMPTY_RECORD,
    });

  const first = build();
  assert.equal(first.length, 1);
  assert.equal(first[0].alertKey, placementAlertKey("app-1"));
  assert.equal(first[0].type, PLACEMENT_ALERT_TYPE);
  assert.equal(first[0].sourceType, "application");
  assert.equal(first[0].sourceId, "app-1");
  assert.match(first[0].summary, /"Line Cook" at Mountain Diner/);
  // Idempotent: rebuilding yields the identical descriptor (the sync layer
  // upserts on alertKey, so this is what "exactly one" rests on).
  assert.deepEqual(build(), first);
});

test("self-reported and legacy (null) verification are excluded", () => {
  const alerts = buildPlacementAlertDescriptors({
    scope: ENABLED,
    activeClassIds: [],
    applications: [
      application({ id: "self", verificationStatus: "self_reported" }),
      application({ id: "legacy", verificationStatus: null }),
      application({ id: "not-accepted", status: "offer" }),
    ],
    spokesRecord: EMPTY_RECORD,
  });
  assert.deepEqual(alerts, []);
});

test("recorded employment retires the queue item regardless of provenance", () => {
  const manualEntry = buildPlacementAlertDescriptors({
    scope: ENABLED,
    activeClassIds: [],
    applications: [application()],
    spokesRecord: {
      placementApplicationId: null,
      unsubsidizedEmploymentAt: new Date("2026-07-01"),
    },
  });
  assert.deepEqual(manualEntry, []);
});

test("a missing SpokesRecord still raises the item, with create guidance", () => {
  const alerts = buildPlacementAlertDescriptors({
    scope: ENABLED,
    activeClassIds: [],
    applications: [application()],
    spokesRecord: null,
  });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].summary, /no SPOKES record yet/);
});

test("two qualifying applications raise one item each, keyed per application", () => {
  const alerts = buildPlacementAlertDescriptors({
    scope: ENABLED,
    activeClassIds: [],
    applications: [application({ id: "app-1" }), application({ id: "app-2" })],
    spokesRecord: EMPTY_RECORD,
  });
  assert.deepEqual(
    alerts.map((alert) => alert.alertKey).sort(),
    ["placement_outcome:app-1", "placement_outcome:app-2"]
  );
});

// --- prefill suggestion ------------------------------------------------------

test("suggestion picks the most recently verified qualifying application", () => {
  const suggestion = buildPlacementSuggestion({
    scope: ENABLED,
    activeClassIds: [],
    applications: [
      application({ id: "older", verifiedAt: new Date("2026-07-01T00:00:00Z") }),
      application({ id: "newer", verifiedAt: new Date("2026-07-28T00:00:00Z") }),
      application({ id: "unverified", verificationStatus: "self_reported" }),
    ],
    spokesRecord: EMPTY_RECORD,
  });
  assert.equal(suggestion?.applicationId, "newer");
  assert.equal(suggestion?.company, "Mountain Diner");
  assert.equal(suggestion?.verifiedAt, "2026-07-28T00:00:00.000Z");
});

test("suggestion is null when off, none qualify, or employment is recorded", () => {
  assert.equal(
    buildPlacementSuggestion({
      scope: { mode: "off" },
      activeClassIds: [],
      applications: [application()],
      spokesRecord: EMPTY_RECORD,
    }),
    null
  );
  assert.equal(
    buildPlacementSuggestion({
      scope: ENABLED,
      activeClassIds: [],
      applications: [application({ verificationStatus: "self_reported" })],
      spokesRecord: EMPTY_RECORD,
    }),
    null
  );
  assert.equal(
    buildPlacementSuggestion({
      scope: ENABLED,
      activeClassIds: [],
      applications: [application()],
      spokesRecord: {
        placementApplicationId: "app-1",
        unsubsidizedEmploymentAt: new Date("2026-07-01"),
      },
    }),
    null
  );
});

// --- provenance validation for the SPOKES PUT --------------------------------

const employmentDate = new Date("2026-07-30");

test("provenance accepts a verified accepted application", () => {
  assert.deepEqual(
    evaluatePlacementProvenance({
      application: application(),
      employmentDate,
    }),
    { ok: true }
  );
});

// The route queries applications scoped to the student, so "does not exist"
// and "belongs to a different student" both arrive here as null — and both
// must come back as the same plain 404 (no existence oracle on global ids).
test("provenance rejects a missing or foreign application with one plain 404", () => {
  const check = evaluatePlacementProvenance({
    application: null,
    employmentDate,
  });
  assert.equal(check.ok, false);
  assert.equal(!check.ok && check.status, 404);
  assert.equal(!check.ok && check.message, "Application not found.");
});

test("provenance rejects unverified or non-accepted applications with 409", () => {
  for (const app of [
    application({ verificationStatus: "self_reported" }),
    application({ verificationStatus: null }),
    application({ status: "interviewing" }),
  ]) {
    const check = evaluatePlacementProvenance({
      application: app,
      employmentDate,
    });
    assert.equal(!check.ok && check.status, 409);
  }
});

test("provenance requires an employment start date", () => {
  const check = evaluatePlacementProvenance({
    application: application(),
    employmentDate: null,
  });
  assert.equal(!check.ok && check.status, 400);
  assert.match((!check.ok && check.message) || "", /start date/);
});
