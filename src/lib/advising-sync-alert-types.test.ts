import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, it, mock } from "node:test";

// "server-only" throws at import time outside a Next.js server build, and the
// context module reaches the database client; neither is used here.
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/db", { namedExports: { prisma: {} } });

const LIB = path.join(process.cwd(), "src", "lib");

function source(file: string): string {
  return readFileSync(path.join(LIB, file), "utf8");
}

/** Every `type: <expression>` in a file, split into string literals and the rest. */
function typeExpressions(file: string): { literals: string[]; others: string[] } {
  const expressions = [...source(file).matchAll(/\btype: ([^,;\n]+)[,;]/g)].map((match) => match[1].trim());
  const literals = expressions.flatMap((expression) => {
    const literal = /^"([a-z_]+)"$/.exec(expression);
    return literal ? [literal[1]] : [];
  });
  return { literals, others: expressions.filter((expression) => !/^"[a-z_]+"$/.test(expression)) };
}

let SYNC_ALERT_TYPES: readonly string[];
let GOAL_REVIEW_ITEM_KINDS: readonly string[];
let INACTIVITY_ALERT_TYPES: readonly string[];
let LEGACY_INACTIVITY_ALERT_TYPES: readonly string[];
let PLACEMENT_ALERT_TYPE: string;

before(async () => {
  ({ SYNC_ALERT_TYPES } = await import("@/lib/advising-sync-context"));
  ({ GOAL_REVIEW_ITEM_KINDS } = await import("@/lib/goal-evidence"));
  ({ INACTIVITY_ALERT_TYPES, LEGACY_INACTIVITY_ALERT_TYPES } = await import("@/lib/inactivity"));
  ({ PLACEMENT_ALERT_TYPE } = await import("@/lib/placement-bridge"));
});

// The sync reads back only the alert types in SYNC_ALERT_TYPES. A type it
// writes but does not read is reopened after a teacher dismisses it and is
// never resolved; a type it reads but does not write is resolved on every run,
// which wipes out another writer's alerts. So the two sets must be equal.
//
// The writers are the four parts of desiredAlerts in advising-sync.ts. Each
// is pinned to its source, so a new alert type there fails this test.
describe("SYNC_ALERT_TYPES", () => {
  it("knows every way buildStudentAlertDescriptors sets a type", () => {
    const { others } = typeExpressions("advising-alerts.ts");
    // `type: string` is the AlertDescriptor field; the inactivity stage type
    // comes from INACTIVITY_ALERT_TYPES.
    assert.deepEqual(others, ["string", "inactivityStage.type"]);
    // The one alert pushed whole is the shared goal_stale rule.
    const pushedWhole = [...source("advising-alerts.ts").matchAll(/alerts\.push\((\w+)\)/g)].map((m) => m[1]);
    assert.deepEqual(pushedWhole, ["staleAlert"]);
    assert.deepEqual(typeExpressions("stale-goal-rules.ts").literals, ["goal_stale", "goal_stale"]);
  });

  it("knows every way advising-sync.ts sets a type", () => {
    const { literals, others } = typeExpressions("advising-sync.ts");
    assert.deepEqual(literals, ["motivation_declining"]);
    // item.kind is a GoalReviewItemKind; alert.type copies a desired alert.
    assert.deepEqual(others, ["item.kind", "alert.type"]);
    assert.deepEqual(typeExpressions("placement-bridge.ts").others, ["PLACEMENT_ALERT_TYPE"]);
  });

  it("equals the set of alert types the sync writes", () => {
    const written = new Set<string>([
      ...typeExpressions("advising-alerts.ts").literals,
      "goal_stale",
      ...INACTIVITY_ALERT_TYPES,
      ...GOAL_REVIEW_ITEM_KINDS,
      "motivation_declining",
      PLACEMENT_ALERT_TYPE,
      // Not written any more, but read so that old rows still resolve.
      ...LEGACY_INACTIVITY_ALERT_TYPES,
    ]);

    assert.deepEqual([...new Set(SYNC_ALERT_TYPES)].sort(), [...written].sort());
    assert.equal(new Set(SYNC_ALERT_TYPES).size, SYNC_ALERT_TYPES.length, "no type is listed twice");
  });
});
