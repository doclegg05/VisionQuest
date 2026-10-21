import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDemoLimits, type DemoLimits } from "@/lib/demo/config";
import { chatLimitsFor, type ChatLimits } from "./chat-limits";

// The Sage chat limits as one pure table. The route owns the counters and the
// keys; this file owns only which numbers apply to whom. Real accounts must
// get exactly the numbers the route used to hold inline, so the table below
// is the regression pin for them.

const DEMO: DemoLimits = getDemoLimits({});

type RealRow = {
  who: string;
  role: string;
  isStaffChat: boolean;
  hourly: number;
  cloudDaily: number | null;
};

// `isStaffChat` is what the route computes: teacher, admin and coordinator are
// all true. Admin has no daily cap on any provider.
const REAL_ROWS: ReadonlyArray<RealRow> = [
  { who: "admin", role: "admin", isStaffChat: true, hourly: 120, cloudDaily: null },
  { who: "teacher", role: "teacher", isStaffChat: true, hourly: 60, cloudDaily: 400 },
  { who: "coordinator", role: "coordinator", isStaffChat: true, hourly: 60, cloudDaily: 400 },
  { who: "student", role: "student", isStaffChat: false, hourly: 40, cloudDaily: 200 },
];

describe("chatLimitsFor", () => {
  it("keeps real accounts at today's limits", () => {
    for (const row of REAL_ROWS) {
      for (const isCloudProvider of [true, false]) {
        const expected: ChatLimits = {
          hourly: row.hourly,
          perAccountDaily: isCloudProvider ? row.cloudDaily : null,
          demoWideDaily: null,
        };
        const input = { role: row.role, isStaffChat: row.isStaffChat, isCloudProvider };
        const label = `${row.who}, ${isCloudProvider ? "cloud" : "not cloud"}`;

        // The route passes no demo limits for a real account.
        assert.deepEqual(chatLimitsFor(input), expected, label);
        // And demo limits, if they ever arrived, would still not touch one.
        assert.deepEqual(chatLimitsFor(input, DEMO), expected, `${label}, demo limits supplied`);
      }
    }
  });

  it("gives the demo instructor 300/hour and 1000/day on any provider", () => {
    for (const isCloudProvider of [true, false]) {
      const limits = chatLimitsFor(
        { role: "teacher", isStaffChat: true, isCloudProvider, demoAccount: "instructor" },
        DEMO,
      );
      assert.equal(limits.hourly, 300, isCloudProvider ? "cloud" : "not cloud");
      assert.equal(limits.perAccountDaily, 1000, isCloudProvider ? "cloud" : "not cloud");
    }
  });

  it("takes the demo instructor's numbers from the demo limits, not from constants", () => {
    const custom: DemoLimits = {
      ...DEMO,
      instructorSageHourly: 7,
      instructorSageDaily: 11,
      sageDaily: 13,
    };
    assert.deepEqual(
      chatLimitsFor(
        { role: "teacher", isStaffChat: true, isCloudProvider: false, demoAccount: "instructor" },
        custom,
      ),
      { hourly: 7, perAccountDaily: 11, demoWideDaily: 13 },
    );
  });

  it("adds the demo-wide daily cap for any demo account", () => {
    const kinds = [
      { demoAccount: "student", role: "student", isStaffChat: false },
      { demoAccount: "instructor", role: "teacher", isStaffChat: true },
    ] as const;
    for (const kind of kinds) {
      for (const isCloudProvider of [true, false]) {
        const limits = chatLimitsFor({ ...kind, isCloudProvider }, DEMO);
        assert.equal(
          limits.demoWideDaily,
          DEMO.sageDaily,
          `${kind.demoAccount}, ${isCloudProvider ? "cloud" : "not cloud"}`,
        );
      }
    }
  });

  it("gives a demo student the real student numbers plus the demo-wide cap", () => {
    const base = { role: "student", isStaffChat: false, demoAccount: "student" } as const;
    assert.deepEqual(chatLimitsFor({ ...base, isCloudProvider: true }, DEMO), {
      hourly: 40,
      perAccountDaily: 200,
      demoWideDaily: DEMO.sageDaily,
    });
    assert.deepEqual(chatLimitsFor({ ...base, isCloudProvider: false }, DEMO), {
      hourly: 40,
      perAccountDaily: null,
      demoWideDaily: DEMO.sageDaily,
    });
  });

  it("refuses to price a demo account without the demo limits", () => {
    assert.throws(
      () =>
        chatLimitsFor({
          role: "student",
          isStaffChat: false,
          isCloudProvider: false,
          demoAccount: "student",
        }),
      /demo limits/i,
    );
  });
});
