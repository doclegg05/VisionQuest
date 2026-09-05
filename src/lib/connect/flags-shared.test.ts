import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONNECT_CONFIG_KEY,
  CONNECT_SUBSIDY_LINES_CONFIG_KEY,
  intersectScopeClassIds,
  isConnectEnabledForClasses,
  isSubsidyLinesEnabled,
  parseConnectScope,
} from "./flags-shared";

describe("connect_enabled_classes", () => {
  it("names the SystemConfig keys the plan specifies", () => {
    assert.equal(CONNECT_CONFIG_KEY, "connect_enabled_classes");
    assert.equal(CONNECT_SUBSIDY_LINES_CONFIG_KEY, "connect_subsidy_lines_enabled");
  });

  it("is OFF when unset, empty or whitespace — never on by accident", () => {
    for (const raw of [null, "", "   ", ",", " , , "]) {
      assert.deepEqual(parseConnectScope(raw), { mode: "off" }, JSON.stringify(raw));
      assert.equal(isConnectEnabledForClasses(parseConnectScope(raw), ["class-a"]), false);
    }
  });

  it('"all" turns it on program-wide, case-insensitively', () => {
    assert.deepEqual(parseConnectScope("all"), { mode: "all" });
    assert.deepEqual(parseConnectScope(" ALL "), { mode: "all" });
    assert.equal(isConnectEnabledForClasses({ mode: "all" }, []), true);
  });

  it("takes a comma-separated class list and trims it", () => {
    assert.deepEqual(parseConnectScope("class-a, class-b ,"), {
      mode: "classes",
      classIds: ["class-a", "class-b"],
    });
  });

  it("enables only students actively in a listed class", () => {
    const scope = parseConnectScope("class-a,class-b");
    assert.equal(isConnectEnabledForClasses(scope, ["class-b"]), true);
    assert.equal(isConnectEnabledForClasses(scope, ["class-c"]), false);
    assert.equal(isConnectEnabledForClasses(scope, []), false);
  });

  it("only treats an explicit true/on/1 as the subsidy-line opt-in", () => {
    for (const raw of ["true", "TRUE", " on ", "1", "yes"]) {
      assert.equal(isSubsidyLinesEnabled(raw), true, raw);
    }
    for (const raw of [null, "", "false", "0", "off", "maybe"]) {
      assert.equal(isSubsidyLinesEnabled(raw), false, JSON.stringify(raw));
    }
  });
});

describe("intersectScopeClassIds", () => {
  // The nudge runner's roster query applies a `take` in Postgres, BEFORE any
  // in-memory flag check, so the class filter has to be right in the WHERE
  // clause. Getting it wrong is silent: the weekly text goes to nobody and
  // nothing errors. Hence the full truth table rather than a spot check.
  const all = { mode: "all" } as const;
  const off = { mode: "off" } as const;
  const classes = (...ids: string[]) => ({ mode: "classes" as const, classIds: ids });

  it("returns null when every scope is 'all' — there is nothing to filter by", () => {
    assert.equal(intersectScopeClassIds(all, all), null);
    assert.equal(intersectScopeClassIds(all), null);
  });

  it("uses the one class list when the other scope is 'all', in either order", () => {
    assert.deepEqual(intersectScopeClassIds(all, classes("A", "B")), ["A", "B"]);
    assert.deepEqual(intersectScopeClassIds(classes("A", "B"), all), ["A", "B"]);
  });

  it("intersects two class lists", () => {
    assert.deepEqual(intersectScopeClassIds(classes("A", "B"), classes("B", "C")), ["B"]);
  });

  it("returns an empty list for disjoint lists, not null", () => {
    // `null` means "no filter"; an empty list means "match nothing". Confusing
    // the two would open the roster to every class instead of closing it.
    assert.deepEqual(intersectScopeClassIds(classes("A"), classes("B")), []);
  });

  it("an 'off' scope matches nothing, whatever it is paired with", () => {
    assert.deepEqual(intersectScopeClassIds(off, all), []);
    assert.deepEqual(intersectScopeClassIds(off, classes("A")), []);
    assert.deepEqual(intersectScopeClassIds(classes("A"), off), []);
  });
});
