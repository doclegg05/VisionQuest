import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JOB_LEAD_SOURCES,
  JOB_LEAD_STATUSES,
  LEAD_PAY_PERIODS,
  leadHourlyRange,
  leadRequirementsSchema,
  leadScheduleSchema,
  parseLeadRequirements,
  parseLeadSchedule,
} from "./leads-shared";

describe("leadRequirementsSchema", () => {
  it("accepts the four documented lists and defaults each to empty", () => {
    const parsed = leadRequirementsSchema.parse({});
    assert.deepEqual(parsed, {
      mustHaveCerts: [],
      niceToHave: [],
      physical: [],
      licenses: [],
    });
  });

  it("rejects an unknown key rather than silently dropping it", () => {
    assert.equal(leadRequirementsSchema.safeParse({ mustHaveSkills: ["x"] }).success, false);
  });

  it("rejects a non-array list", () => {
    assert.equal(leadRequirementsSchema.safeParse({ mustHaveCerts: "forklift" }).success, false);
  });
});

describe("leadScheduleSchema", () => {
  it("accepts the four shift names and nothing else", () => {
    assert.equal(
      leadScheduleSchema.safeParse({ shifts: ["day", "evening", "night", "weekend"] }).success,
      true,
    );
    assert.equal(leadScheduleSchema.safeParse({ shifts: ["graveyard"] }).success, false);
  });

  it("defaults shifts to an empty list, which the matcher reads as 'not asked'", () => {
    assert.deepEqual(leadScheduleSchema.parse({}).shifts, []);
  });

  it("rejects an hours range that runs backwards", () => {
    assert.equal(
      leadScheduleSchema.safeParse({ shifts: [], hoursPerWeekMin: 40, hoursPerWeekMax: 20 })
        .success,
      false,
    );
  });
});

describe("parseLeadRequirements / parseLeadSchedule", () => {
  it("KEEP a known list when a stored row carries an unknown extra key", () => {
    // The write schema is strict so a typo is a 400. The read path must not
    // be: .strict() fails the whole object on one unknown key, and the failure
    // path returns the empty default — so a lead written by a later version
    // would come back with mustHaveCerts: [] and the matcher would silently
    // stop enforcing a certification.
    const stored = {
      mustHaveCerts: ["forklift-operator"],
      niceToHave: [],
      physical: [],
      licenses: [],
      preferredShifts: ["day"],
    };
    assert.deepEqual(parseLeadRequirements(stored).mustHaveCerts, ["forklift-operator"]);

    const schedule = { shifts: ["day"], overtimeLikely: true };
    assert.deepEqual(parseLeadSchedule(schedule).shifts, ["day"]);
  });

  it("does not hand the unknown key on to the matcher", () => {
    const parsed = parseLeadRequirements({ mustHaveCerts: [], niceToHave: [], physical: [], licenses: [], preferredShifts: ["day"] });
    assert.deepEqual(Object.keys(parsed).sort(), ["licenses", "mustHaveCerts", "niceToHave", "physical"]);
  });

  it("degrade a malformed stored value to the safe default instead of throwing", () => {
    assert.deepEqual(parseLeadRequirements("not json at all").mustHaveCerts, []);
    assert.deepEqual(parseLeadSchedule(42).shifts, []);
    assert.deepEqual(parseLeadSchedule(null).shifts, []);
  });

  it("read a well-formed stored value back unchanged", () => {
    const stored = { shifts: ["day"], hoursPerWeekMin: 20, hoursPerWeekMax: 40 };
    assert.deepEqual(parseLeadSchedule(stored).shifts, ["day"]);
    assert.equal(parseLeadSchedule(stored).hoursPerWeekMax, 40);
  });
});

describe("leadHourlyRange", () => {
  it("passes an hourly lead through untouched", () => {
    assert.deepEqual(leadHourlyRange({ payMin: 15, payMax: 18, payPeriod: "hour" }), {
      min: 15,
      max: 18,
    });
  });

  it("converts a yearly figure with the shared salary parser, not a local constant", () => {
    // 31,200 / 2080 = 15.00 — the same conversion parseSalaryToHourly performs.
    assert.deepEqual(leadHourlyRange({ payMin: 31200, payMax: null, payPeriod: "year" }), {
      min: 15,
      max: null,
    });
  });

  it("converts a weekly figure ($600 a week = $15/hr), the case #175 was cut for", () => {
    assert.deepEqual(leadHourlyRange({ payMin: 600, payMax: null, payPeriod: "week" }), {
      min: 15,
      max: null,
    });
  });

  it("returns nulls when the lead states no pay", () => {
    assert.deepEqual(leadHourlyRange({ payMin: null, payMax: null, payPeriod: "hour" }), {
      min: null,
      max: null,
    });
  });

  it("returns null rather than a wrong number for an implausible conversion", () => {
    // $600/hour is outside the parser's plausible band; a bogus number in the
    // pay floor comparison would hard-block a student for no reason.
    assert.equal(leadHourlyRange({ payMin: 600, payMax: null, payPeriod: "hour" }).min, null);
  });
});

describe("lead vocabularies", () => {
  it("name exactly the states and sources the spec allows", () => {
    assert.deepEqual([...JOB_LEAD_STATUSES], ["open", "filled", "paused", "closed"]);
    assert.deepEqual([...JOB_LEAD_SOURCES], ["manual", "opportunity", "joblisting", "joborder"]);
    assert.deepEqual([...LEAD_PAY_PERIODS], ["hour", "day", "week", "month", "year"]);
  });
});
