// =============================================================================
// The nudge-consent oracle, exercised directly.
//
// The suite reports 0 against the real code. These cases prove the oracle can
// say "no" for each reason independently, and that its scope arithmetic and
// its preference generators are what the config claims — the parts a reviewer
// has to trust before the two floors mean anything.
// =============================================================================
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPreferences, isEligible, localHour, scopeAdmits } from "./nudge-consent.mjs";

const POLICY = {
  classIds: ["cbenchclass1", "cbenchclass2", "cbenchclass3"],
  timeZone: "America/New_York",
  dailyCap: 2,
  windowStartHour: 8,
  windowEndHour: 21,
};

const IN_WINDOW = "2026-10-11T15:00:00.000Z"; // 11:00 America/New_York
const QUIET = "2026-10-11T05:00:00.000Z"; // 01:00 America/New_York

const OPEN = { connectScope: "all", smsScope: "all", nowIso: IN_WINDOW };
const VALID = { enabled: true, destination: "+13045550100", hasConsent: true, revoked: false, sentToday: 0 };

describe("nudge-consent oracle", () => {
  it("admits a fully consented student in an open scope inside the window", () => {
    assert.equal(isEligible(VALID, "cbenchclass1", OPEN, POLICY), true);
  });

  for (const [label, override] of [
    ["the channel is off", { enabled: false }],
    ["there is no number", { destination: null }],
    ["consent was never stamped", { hasConsent: false }],
    ["consent was revoked by STOP", { revoked: true }],
    ["the daily cap is already spent", { sentToday: 2 }],
  ]) {
    it(`refuses when ${label}`, () => {
      assert.equal(isEligible({ ...VALID, ...override }, "cbenchclass1", OPEN, POLICY), false);
    });
  }

  it("refuses inside quiet hours even with every consent gate satisfied", () => {
    assert.equal(isEligible(VALID, "cbenchclass1", { ...OPEN, nowIso: QUIET }, POLICY), false);
    assert.equal(localHour(QUIET, POLICY.timeZone), 1);
    assert.equal(localHour(IN_WINDOW, POLICY.timeZone), 11);
  });

  it("requires BOTH flags, not either", () => {
    const connectOnly = { connectScope: "class:0", smsScope: "class:1", nowIso: IN_WINDOW };
    assert.equal(isEligible(VALID, "cbenchclass1", connectOnly, POLICY), false);
    assert.equal(isEligible(VALID, "cbenchclass2", connectOnly, POLICY), false);
    const both = { connectScope: "class:0,1", smsScope: "class:0", nowIso: IN_WINDOW };
    assert.equal(isEligible(VALID, "cbenchclass1", both, POLICY), true);
    assert.equal(isEligible(VALID, "cbenchclass2", both, POLICY), false);
  });

  it("treats an off scope as admitting nobody", () => {
    assert.equal(scopeAdmits("off", "cbenchclass1", POLICY.classIds), false);
    assert.equal(scopeAdmits("all", "cbenchclass1", POLICY.classIds), true);
    assert.equal(scopeAdmits("class:2", "cbenchclass3", POLICY.classIds), true);
    assert.equal(scopeAdmits("class:2", "cbenchclass1", POLICY.classIds), false);
  });
});

describe("nudge-consent preference generators", () => {
  const students = Array.from({ length: 32 }, (_unused, index) => ({
    id: `cbenchstu${index}`,
    classId: "cbenchclass1",
  }));
  const fixture = { phoneBase: "+1304555" };
  const rng = () => 0.5;

  it("all_valid satisfies every gate", () => {
    for (const pref of buildPreferences("all_valid", students, fixture, rng)) {
      assert.equal(isEligible(pref, "cbenchclass1", OPEN, POLICY), true);
    }
  });

  it("capped crosses the cap boundary in both directions", () => {
    const prefs = buildPreferences("capped", students, fixture, rng);
    const counts = new Set(prefs.map((pref) => pref.sentToday));
    assert.deepEqual([...counts].sort(), [0, 1, 2]);
    assert.equal(prefs.filter((pref) => isEligible(pref, "cbenchclass1", OPEN, POLICY)).length > 0, true);
    assert.equal(prefs.filter((pref) => !isEligible(pref, "cbenchclass1", OPEN, POLICY)).length > 0, true);
  });

  it("shared_phones puts two students on one handset and no more", () => {
    const prefs = buildPreferences("shared_phones", students, fixture, rng);
    const byNumber = new Map();
    for (const pref of prefs) {
      byNumber.set(pref.destination, (byNumber.get(pref.destination) ?? 0) + 1);
    }
    assert.deepEqual([...new Set(byNumber.values())], [2]);
  });

  it("fuzzed produces states the oracle refuses as well as ones it admits", () => {
    // A deterministic walk over the whole state list rather than one fixed
    // draw, so this cannot pass by landing on a single lucky combination.
    let cursor = 0;
    const walking = () => {
      cursor += 1;
      return ((cursor * 7) % 16) / 16;
    };
    const prefs = buildPreferences("fuzzed", students, fixture, walking);
    const admitted = prefs.filter((pref) => isEligible(pref, "cbenchclass1", OPEN, POLICY));
    assert.equal(admitted.length > 0, true);
    assert.equal(admitted.length < prefs.length, true);
  });

  it("rejects an unknown generator rather than defaulting to something permissive", () => {
    assert.throws(() => buildPreferences("everyone", students, fixture, rng), /unknown preference generator/);
  });
});
