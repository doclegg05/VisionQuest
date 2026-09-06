// =============================================================================
// Red-first proof for the nudge-quiet-hours suite.
//
// The suite reports 0 on all four counters against the real policy. A counter
// that has only ever been seen at 0 is indistinguishable from a counter that
// cannot rise, so each one is driven here with a synthetic decision that IS
// wrong and asserted to count it.
//
// classifyDecision is pure and takes the decision as data, so this needs no
// mock of the policy and no throwaway edit to production code.
// =============================================================================
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyDecision, localParts, tally } from "./nudge-quiet-hours.mjs";

const POLICY = {
  timeZone: "America/New_York",
  windowStartHour: 8,
  windowEndHour: 21,
  dailyCap: 2,
};

/** 03:00 America/New_York on a winter night — deep inside quiet hours. */
const NIGHT = new Date("2026-01-15T08:00:00.000Z");
/** 10:00 America/New_York on a summer weekday — inside the send window. */
const MIDDAY = new Date("2026-07-15T14:00:00.000Z");

describe("nudge-quiet-hours classifier", () => {
  it("reads the local hour through a different formatting path than the policy", () => {
    assert.equal(localParts(NIGHT, POLICY.timeZone).hour, 3);
    assert.equal(localParts(MIDDAY, POLICY.timeZone).hour, 10);
    // Fall-back day: 01:30 local happens twice; both instants must read as 01.
    assert.equal(localParts(new Date("2026-11-01T05:30:00.000Z"), POLICY.timeZone).hour, 1);
    assert.equal(localParts(new Date("2026-11-01T06:30:00.000Z"), POLICY.timeZone).hour, 1);
  });

  it("counts an allow at 03:00 local as outside_window_sends", () => {
    const found = classifyDecision(
      { at: NIGHT, sentTodayCount: 0, decision: { decision: "allow" } },
      POLICY,
    );
    assert.deepEqual(
      found.map((v) => v.kind),
      ["outside_window_sends"],
    );
    assert.equal(tally(found).counts.outside_window_sends, 1);
  });

  it("counts an allow at or over the cap as cap_violations", () => {
    const found = classifyDecision(
      { at: MIDDAY, sentTodayCount: POLICY.dailyCap, decision: { decision: "allow" } },
      POLICY,
    );
    assert.deepEqual(
      found.map((v) => v.kind),
      ["cap_violations"],
    );
  });

  it("counts both when a single allow breaks both rules at once", () => {
    const found = classifyDecision(
      { at: NIGHT, sentTodayCount: 5, decision: { decision: "allow" } },
      POLICY,
    );
    const { counts } = tally(found);
    assert.equal(counts.outside_window_sends, 1);
    assert.equal(counts.cap_violations, 1);
  });

  it("counts a deferral to the wrong local hour as deferral_outside_window", () => {
    // 07:00 local — the classic off-by-one-hour a naive +24h produces on a
    // DST day, which is exactly what this metric exists to catch.
    const found = classifyDecision(
      {
        at: NIGHT,
        sentTodayCount: 0,
        decision: { decision: "defer", until: new Date("2026-01-15T12:00:00.000Z") },
      },
      POLICY,
    );
    assert.deepEqual(
      found.map((v) => v.kind),
      ["deferral_outside_window"],
    );
  });

  it("counts a deferral into the past as deferral_not_in_future", () => {
    const found = classifyDecision(
      {
        at: MIDDAY,
        sentTodayCount: 0,
        // 08:00 local the SAME morning: the right hour, the wrong day.
        decision: { decision: "defer", until: new Date("2026-07-15T12:00:00.000Z") },
      },
      POLICY,
    );
    assert.deepEqual(
      found.map((v) => v.kind),
      ["deferral_not_in_future"],
    );
  });

  it("passes a correct allow and a correct deferral", () => {
    assert.deepEqual(
      classifyDecision({ at: MIDDAY, sentTodayCount: 0, decision: { decision: "allow" } }, POLICY),
      [],
    );
    assert.deepEqual(
      classifyDecision(
        {
          at: NIGHT,
          sentTodayCount: 0,
          decision: { decision: "defer", until: new Date("2026-01-15T13:00:00.000Z") },
        },
        POLICY,
      ),
      [],
    );
  });
});
