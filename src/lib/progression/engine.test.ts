import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInitialState,
  getAchievementsWithDefs,
  getXpProgress,
  parseState,
  recordChatSession,
  recordDailyCheckin,
  recordGoalSet,
  recordMonthlyReview,
  recordTaskComplete,
  recordWeeklyReview,
  ACHIEVEMENT_DEFS,
} from "./engine";

// ---------------------------------------------------------------------------
// Clock helper — freezes Date to a fixed ISO instant for the duration of fn()
// ---------------------------------------------------------------------------

const RealDate = Date;

function withFrozenDate<T>(iso: string, fn: () => T): T {
  class MockDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? iso);
    }
    static now() {
      return new RealDate(iso).getTime();
    }
    static parse(value: string) {
      return RealDate.parse(value);
    }
    static UTC(
      year: number,
      monthIndex: number,
      date?: number,
      hours?: number,
      minutes?: number,
      seconds?: number,
      ms?: number
    ) {
      return RealDate.UTC(year, monthIndex, date, hours, minutes, seconds, ms);
    }
  }
  globalThis.Date = MockDate as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe("createInitialState", () => {
  it("returns level 1 with 0 XP", () => {
    const state = createInitialState();
    assert.equal(state.level, 1);
    assert.equal(state.xp, 0);
  });

  it("returns empty arrays for all collection fields", () => {
    const state = createInitialState();
    assert.deepEqual(state.completedGoalLevels, []);
    assert.deepEqual(state.streakDays, []);
    assert.deepEqual(state.achievements, []);
    assert.deepEqual(state.levelUpHistory, []);
  });

  it("returns zero for all numeric counters", () => {
    const state = createInitialState();
    assert.equal(state.dailyCheckinsCount, 0);
    assert.equal(state.currentStreak, 0);
    assert.equal(state.longestStreak, 0);
    assert.equal(state.weeklyReviewsDone, 0);
    assert.equal(state.monthlyReviewsDone, 0);
  });

  it("returns independent objects on each call so mutations do not bleed across", () => {
    const a = createInitialState();
    const b = createInitialState();
    a.achievements.push("xp:task_complete");
    assert.equal(b.achievements.length, 0);
  });
});

// ---------------------------------------------------------------------------
// parseState
// ---------------------------------------------------------------------------

describe("parseState", () => {
  it("returns the initial state for null input", () => {
    assert.deepEqual(parseState(null), createInitialState());
  });

  it("returns the initial state for an empty string", () => {
    assert.deepEqual(parseState(""), createInitialState());
  });

  it("returns the initial state for invalid JSON", () => {
    assert.deepEqual(parseState("{not-json"), createInitialState());
  });

  it("parses valid JSON and preserves numeric and array fields", () => {
    const raw = JSON.stringify({
      level: 3,
      xp: 600,
      completedGoalLevels: ["bhag", "monthly"],
      dailyCheckinsCount: 5,
      currentStreak: 5,
      longestStreak: 7,
      streakDays: ["2026-03-10", "2026-03-11"],
      weeklyReviewsDone: 2,
      monthlyReviewsDone: 1,
      achievements: ["xp:bhag_set"],
      levelUpHistory: [{ level: 2, at: "2026-03-01T00:00:00.000Z", reason: "bhag_set" }],
    });
    const state = parseState(raw);
    assert.equal(state.level, 3);
    assert.equal(state.xp, 600);
    assert.deepEqual(state.completedGoalLevels, ["bhag", "monthly"]);
    assert.equal(state.dailyCheckinsCount, 5);
    assert.equal(state.weeklyReviewsDone, 2);
    assert.equal(state.monthlyReviewsDone, 1);
    assert.deepEqual(state.achievements, ["xp:bhag_set"]);
  });

  it("clamps level 0 up to 1", () => {
    assert.equal(parseState(JSON.stringify({ level: 0 })).level, 1);
  });

  it("clamps level 99 down to 5", () => {
    assert.equal(parseState(JSON.stringify({ level: 99 })).level, 5);
  });

  it("clamps negative XP to 0", () => {
    assert.equal(parseState(JSON.stringify({ xp: -100 })).xp, 0);
  });

  it("clamps negative dailyCheckinsCount to 0", () => {
    assert.equal(parseState(JSON.stringify({ dailyCheckinsCount: -3 })).dailyCheckinsCount, 0);
  });

  it("replaces a non-array completedGoalLevels with an empty array", () => {
    assert.deepEqual(parseState(JSON.stringify({ completedGoalLevels: "bhag" })).completedGoalLevels, []);
  });

  it("replaces a non-array achievements with an empty array", () => {
    assert.deepEqual(parseState(JSON.stringify({ achievements: null })).achievements, []);
  });

  it("deduplicates and sorts streakDays, drops invalid date strings", () => {
    const state = parseState(
      JSON.stringify({
        streakDays: ["2026-03-03", "2026-03-01T10:00:00.000Z", "2026-03-03", "bad-date"],
      })
    );
    assert.deepEqual(state.streakDays, ["2026-03-01", "2026-03-03"]);
  });
});

// ---------------------------------------------------------------------------
// recordGoalSet — XP, deduplication, achievements
// ---------------------------------------------------------------------------

describe("recordGoalSet — XP and achievements", () => {
  it("adds 50 XP when setting a goal for the first time", () => {
    const state = createInitialState();
    const { xpGained } = recordGoalSet(state, "bhag");
    assert.equal(xpGained, 50);
    assert.equal(state.xp, 50);
  });

  it("gives 0 XP when the same goal level is set a second time", () => {
    const state = createInitialState();
    recordGoalSet(state, "bhag");
    const { xpGained } = recordGoalSet(state, "bhag");
    assert.equal(xpGained, 0);
    assert.equal(state.xp, 50);
  });

  it("does not duplicate the goal level in completedGoalLevels", () => {
    const state = createInitialState();
    recordGoalSet(state, "weekly");
    recordGoalSet(state, "weekly");
    assert.equal(state.completedGoalLevels.filter((l) => l === "weekly").length, 1);
  });

  it("accumulates XP across three distinct goal levels", () => {
    const state = createInitialState();
    recordGoalSet(state, "bhag");
    recordGoalSet(state, "monthly");
    recordGoalSet(state, "weekly");
    assert.equal(state.xp, 150);
  });

  it("unlocks xp:bhag_set achievement for bhag", () => {
    const state = createInitialState();
    recordGoalSet(state, "bhag");
    assert.ok(state.achievements.includes("xp:bhag_set"));
  });

  it("unlocks xp:monthly_set achievement for monthly", () => {
    const state = createInitialState();
    recordGoalSet(state, "monthly");
    assert.ok(state.achievements.includes("xp:monthly_set"));
  });

  it("unlocks xp:weekly_set achievement for weekly", () => {
    const state = createInitialState();
    recordGoalSet(state, "weekly");
    assert.ok(state.achievements.includes("xp:weekly_set"));
  });

  it("unlocks xp:daily_set achievement for daily", () => {
    const state = createInitialState();
    recordGoalSet(state, "daily");
    assert.ok(state.achievements.includes("xp:daily_set"));
  });

  it("unlocks xp:task_set achievement for task", () => {
    const state = createInitialState();
    recordGoalSet(state, "task");
    assert.ok(state.achievements.includes("xp:task_set"));
  });

  it("does not duplicate an achievement on repeated goal set", () => {
    const state = createInitialState();
    recordGoalSet(state, "bhag");
    recordGoalSet(state, "bhag");
    assert.equal(state.achievements.filter((a) => a === "xp:bhag_set").length, 1);
  });
});

// ---------------------------------------------------------------------------
// recordGoalSet — level progression
// ---------------------------------------------------------------------------

describe("recordGoalSet — level progression", () => {
  it("advances level to 2 after setting bhag", () => {
    const state = createInitialState();
    const { levelChanged } = recordGoalSet(state, "bhag");
    assert.equal(state.level, 2);
    assert.ok(levelChanged);
  });

  it("advances level to 2 after setting monthly", () => {
    const state = createInitialState();
    const { levelChanged } = recordGoalSet(state, "monthly");
    assert.equal(state.level, 2);
    assert.ok(levelChanged);
  });

  it("advances level to 3 after setting weekly", () => {
    const state = createInitialState();
    const { levelChanged } = recordGoalSet(state, "weekly");
    assert.equal(state.level, 3);
    assert.ok(levelChanged);
  });

  it("advances level to 4 after setting daily", () => {
    const state = createInitialState();
    const { levelChanged } = recordGoalSet(state, "daily");
    assert.equal(state.level, 4);
    assert.ok(levelChanged);
  });

  it("advances level to 5 after setting task", () => {
    const state = createInitialState();
    const { levelChanged } = recordGoalSet(state, "task");
    assert.equal(state.level, 5);
    assert.ok(levelChanged);
  });

  it("level never decreases when a lower-hierarchy goal follows a higher one", () => {
    const state = createInitialState();
    recordGoalSet(state, "task");   // level 5
    recordGoalSet(state, "bhag");   // would be level 2 alone — must stay 5
    assert.equal(state.level, 5);
  });

  it("does not report levelChanged on a duplicate goal call", () => {
    const state = createInitialState();
    recordGoalSet(state, "task");
    const { levelChanged } = recordGoalSet(state, "task");
    assert.ok(!levelChanged);
  });

  it("adds a levelUpHistory entry on level increase", () => {
    const state = createInitialState();
    recordGoalSet(state, "bhag");
    assert.equal(state.levelUpHistory.length, 1);
    assert.equal(state.levelUpHistory[0]?.level, 2);
    assert.equal(state.levelUpHistory[0]?.reason, "bhag_set");
  });

  it("does not add a levelUpHistory entry on a duplicate goal call", () => {
    const state = createInitialState();
    recordGoalSet(state, "bhag");
    recordGoalSet(state, "bhag");
    assert.equal(state.levelUpHistory.length, 1);
  });

  it("unlocks all lower level achievements when jumping straight to level 5", () => {
    const state = createInitialState();
    recordGoalSet(state, "task");
    for (let l = 2; l <= 5; l++) {
      assert.ok(state.achievements.includes(`level:${l}`), `expected level:${l}`);
    }
  });

  it("unlocks only level:2 and level:3 when reaching level 3 via weekly", () => {
    const state = createInitialState();
    recordGoalSet(state, "weekly");
    assert.ok(state.achievements.includes("level:2"));
    assert.ok(state.achievements.includes("level:3"));
    assert.ok(!state.achievements.includes("level:4"));
    assert.ok(!state.achievements.includes("level:5"));
  });
});

// ---------------------------------------------------------------------------
// recordDailyCheckin — base XP, counters, streak tracking
// ---------------------------------------------------------------------------

describe("recordDailyCheckin — base XP and counters", () => {
  it("adds 15 XP on a single check-in", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T12:00:00.000Z", () => {
      const { xpGained } = recordDailyCheckin(state);
      assert.equal(xpGained, 15);
    });
    assert.equal(state.xp, 15);
  });

  it("increments dailyCheckinsCount on each call", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    withFrozenDate("2026-03-11T12:00:00.000Z", () => recordDailyCheckin(state));
    assert.equal(state.dailyCheckinsCount, 2);
  });

  it("unlocks xp:daily_checkin achievement on first check-in", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    assert.ok(state.achievements.includes("xp:daily_checkin"));
  });

  it("does not duplicate xp:daily_checkin achievement on repeated check-ins", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    withFrozenDate("2026-03-11T12:00:00.000Z", () => recordDailyCheckin(state));
    assert.equal(state.achievements.filter((a) => a === "xp:daily_checkin").length, 1);
  });

  it("adds today as a YYYY-MM-DD entry in streakDays", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    assert.ok(state.streakDays.includes("2026-03-10"));
  });

  it("returns streakMilestone null when no milestone day is reached", () => {
    const state = createInitialState();
    const result = withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    assert.equal(result.streakMilestone, null);
  });

  it("updates longestStreak when current streak grows past it", () => {
    const state = createInitialState();
    state.longestStreak = 0;
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    assert.equal(state.longestStreak, 1);
  });

  it("does not reduce longestStreak when current streak is shorter", () => {
    const state = createInitialState();
    state.longestStreak = 10;
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    assert.equal(state.longestStreak, 10);
  });
});

describe("recordDailyCheckin — streak milestones", () => {
  it("awards 25 XP bonus and streak:3 achievement at day 3", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    withFrozenDate("2026-03-11T12:00:00.000Z", () => recordDailyCheckin(state));
    const result = withFrozenDate("2026-03-12T12:00:00.000Z", () => recordDailyCheckin(state));

    assert.equal(state.currentStreak, 3);
    assert.equal(result.streakMilestone, 3);
    assert.equal(result.xpGained, 15 + 25);
    assert.ok(state.achievements.includes("streak:3"));
  });

  it("awards 75 XP bonus and streak:7 achievement at day 7", () => {
    const state = createInitialState();
    const base = new Date("2026-03-06T12:00:00.000Z");
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      withFrozenDate(d.toISOString(), () => recordDailyCheckin(state));
    }

    assert.equal(state.currentStreak, 7);
    assert.ok(state.achievements.includes("streak:7"));
    // Total XP: 7 * 15 (base) + 25 (day 3) + 75 (day 7) = 205
    assert.equal(state.xp, 7 * 15 + 25 + 75);
  });

  it("awards 150 XP bonus and streak:14 achievement at day 14", () => {
    const state = createInitialState();
    const base = new Date("2026-03-01T12:00:00.000Z");
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      withFrozenDate(d.toISOString(), () => recordDailyCheckin(state));
    }

    assert.equal(state.currentStreak, 14);
    assert.ok(state.achievements.includes("streak:14"));
    // 14 * 15 (base) + 25 (day 3) + 75 (day 7) + 150 (day 14) = 460
    assert.equal(state.xp, 14 * 15 + 25 + 75 + 150);
  });

  it("awards 300 XP bonus and streak:30 achievement at day 30", () => {
    const state = createInitialState();
    const base = new Date("2026-02-01T12:00:00.000Z");
    for (let i = 0; i < 30; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      withFrozenDate(d.toISOString(), () => recordDailyCheckin(state));
    }

    assert.equal(state.currentStreak, 30);
    assert.ok(state.achievements.includes("streak:30"));
  });

  it("does not award a streak bonus a second time once the achievement is already earned", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T12:00:00.000Z", () => recordDailyCheckin(state));
    withFrozenDate("2026-03-11T12:00:00.000Z", () => recordDailyCheckin(state));
    // Day 3 — earns the bonus for the first time
    withFrozenDate("2026-03-12T12:00:00.000Z", () => recordDailyCheckin(state));
    const xpAfterBonus = state.xp;

    // Same day again (streak stays 3) — bonus must NOT be awarded again
    const result = withFrozenDate("2026-03-12T18:30:00.000Z", () => recordDailyCheckin(state));
    assert.equal(result.xpGained, 15);
    assert.equal(state.xp, xpAfterBonus + 15);
  });

  it("deduplicates same-day check-ins so the streak count is accurate", () => {
    const state = createInitialState();
    withFrozenDate("2026-03-10T08:00:00.000Z", () => recordDailyCheckin(state));
    withFrozenDate("2026-03-10T20:00:00.000Z", () => recordDailyCheckin(state));
    // Only 1 unique day in streakDays even though check-in count is 2
    assert.equal(state.streakDays.length, 1);
    assert.equal(state.currentStreak, 1);
  });
});

// ---------------------------------------------------------------------------
// recordTaskComplete
// ---------------------------------------------------------------------------

describe("recordTaskComplete", () => {
  it("adds 10 XP", () => {
    const state = createInitialState();
    const { xpGained } = recordTaskComplete(state);
    assert.equal(xpGained, 10);
    assert.equal(state.xp, 10);
  });

  it("unlocks xp:task_complete achievement", () => {
    const state = createInitialState();
    recordTaskComplete(state);
    assert.ok(state.achievements.includes("xp:task_complete"));
  });

  it("does not duplicate xp:task_complete on repeated calls", () => {
    const state = createInitialState();
    recordTaskComplete(state);
    recordTaskComplete(state);
    assert.equal(state.achievements.filter((a) => a === "xp:task_complete").length, 1);
  });

  it("accumulates XP across multiple completions", () => {
    const state = createInitialState();
    recordTaskComplete(state);
    recordTaskComplete(state);
    recordTaskComplete(state);
    assert.equal(state.xp, 30);
  });
});

// ---------------------------------------------------------------------------
// recordWeeklyReview
// ---------------------------------------------------------------------------

describe("recordWeeklyReview", () => {
  it("adds 40 XP", () => {
    const state = createInitialState();
    const { xpGained } = recordWeeklyReview(state);
    assert.equal(xpGained, 40);
    assert.equal(state.xp, 40);
  });

  it("increments weeklyReviewsDone", () => {
    const state = createInitialState();
    recordWeeklyReview(state);
    assert.equal(state.weeklyReviewsDone, 1);
    recordWeeklyReview(state);
    assert.equal(state.weeklyReviewsDone, 2);
  });

  it("unlocks xp:weekly_review achievement", () => {
    const state = createInitialState();
    recordWeeklyReview(state);
    assert.ok(state.achievements.includes("xp:weekly_review"));
  });

  it("does not duplicate xp:weekly_review achievement", () => {
    const state = createInitialState();
    recordWeeklyReview(state);
    recordWeeklyReview(state);
    assert.equal(state.achievements.filter((a) => a === "xp:weekly_review").length, 1);
  });
});

// ---------------------------------------------------------------------------
// recordMonthlyReview
// ---------------------------------------------------------------------------

describe("recordMonthlyReview", () => {
  it("adds 60 XP", () => {
    const state = createInitialState();
    const { xpGained } = recordMonthlyReview(state);
    assert.equal(xpGained, 60);
    assert.equal(state.xp, 60);
  });

  it("increments monthlyReviewsDone", () => {
    const state = createInitialState();
    recordMonthlyReview(state);
    assert.equal(state.monthlyReviewsDone, 1);
    recordMonthlyReview(state);
    assert.equal(state.monthlyReviewsDone, 2);
  });

  it("unlocks xp:monthly_review achievement", () => {
    const state = createInitialState();
    recordMonthlyReview(state);
    assert.ok(state.achievements.includes("xp:monthly_review"));
  });

  it("does not duplicate xp:monthly_review achievement", () => {
    const state = createInitialState();
    recordMonthlyReview(state);
    recordMonthlyReview(state);
    assert.equal(state.achievements.filter((a) => a === "xp:monthly_review").length, 1);
  });
});

// ---------------------------------------------------------------------------
// recordChatSession
// ---------------------------------------------------------------------------

describe("recordChatSession", () => {
  it("adds 10 XP", () => {
    const state = createInitialState();
    const { xpGained } = recordChatSession(state);
    assert.equal(xpGained, 10);
    assert.equal(state.xp, 10);
  });

  it("unlocks xp:chat_session achievement", () => {
    const state = createInitialState();
    recordChatSession(state);
    assert.ok(state.achievements.includes("xp:chat_session"));
  });

  it("does not duplicate xp:chat_session achievement", () => {
    const state = createInitialState();
    recordChatSession(state);
    recordChatSession(state);
    assert.equal(state.achievements.filter((a) => a === "xp:chat_session").length, 1);
  });
});

// ---------------------------------------------------------------------------
// getXpProgress
// ---------------------------------------------------------------------------

describe("getXpProgress", () => {
  it("returns ratio 0 and correct targets for a fresh level-1 state", () => {
    const state = createInitialState();
    const progress = getXpProgress(state);
    assert.deepEqual(progress, { current: 0, nextTarget: 200, prevTarget: 0, ratio: 0 });
  });

  it("returns ratio 0.25 for 50 XP at level 1 (threshold 200)", () => {
    const state = createInitialState();
    state.xp = 50;
    const { ratio } = getXpProgress(state);
    assert.equal(ratio, 0.25);
  });

  it("returns ratio 1.0 when XP equals the level threshold exactly", () => {
    const state = createInitialState();
    state.xp = 200;
    const { ratio } = getXpProgress(state);
    assert.equal(ratio, 1);
  });

  it("clamps ratio to 1 when XP exceeds the level threshold", () => {
    const state = createInitialState();
    state.xp = 9999;
    const { ratio } = getXpProgress(state);
    assert.equal(ratio, 1);
  });

  it("computes correct span and ratio for level 2 (prevTarget 200, nextTarget 450)", () => {
    // span = 250; XP 325 is 125 above prevTarget => ratio = 125/250 = 0.5
    const state = createInitialState();
    state.level = 2;
    state.xp = 325;
    const { prevTarget, nextTarget, ratio } = getXpProgress(state);
    assert.equal(prevTarget, 200);
    assert.equal(nextTarget, 450);
    assert.equal(ratio, 0.5);
  });

  it("clamps ratio to 0 when XP is below the prevTarget for the current level", () => {
    // At level 3, prevTarget = 450; XP of 100 is below that floor
    const state = createInitialState();
    state.level = 3;
    state.xp = 100;
    const { ratio } = getXpProgress(state);
    assert.equal(ratio, 0);
  });

  it("uses XP_NEXT_LEVEL[5] = 1500 as nextTarget for a level-5 state", () => {
    const state = createInitialState();
    state.level = 5;
    const { nextTarget } = getXpProgress(state);
    assert.equal(nextTarget, 1500);
  });
});

// ---------------------------------------------------------------------------
// getAchievementsWithDefs
// ---------------------------------------------------------------------------

describe("getAchievementsWithDefs", () => {
  it("returns an empty array when no achievements have been earned", () => {
    assert.deepEqual(getAchievementsWithDefs(createInitialState()), []);
  });

  it("maps a known key to the correct label and desc from ACHIEVEMENT_DEFS", () => {
    const state = createInitialState();
    state.achievements = ["xp:bhag_set"];
    const [entry] = getAchievementsWithDefs(state);
    assert.equal(entry?.key, "xp:bhag_set");
    assert.equal(entry?.label, ACHIEVEMENT_DEFS["xp:bhag_set"]!.label);
    assert.equal(entry?.desc, ACHIEVEMENT_DEFS["xp:bhag_set"]!.desc);
  });

  it("uses the key itself as label and an empty string as desc for unknown keys", () => {
    const state = createInitialState();
    state.achievements = ["custom:unknown"];
    const [entry] = getAchievementsWithDefs(state);
    assert.equal(entry?.key, "custom:unknown");
    assert.equal(entry?.label, "custom:unknown");
    assert.equal(entry?.desc, "");
  });

  it("preserves the order of achievements from state", () => {
    const state = createInitialState();
    state.achievements = ["level:2", "xp:bhag_set", "streak:3"];
    const result = getAchievementsWithDefs(state);
    assert.equal(result[0]?.key, "level:2");
    assert.equal(result[1]?.key, "xp:bhag_set");
    assert.equal(result[2]?.key, "streak:3");
  });

  it("resolves every key defined in ACHIEVEMENT_DEFS without error", () => {
    const state = createInitialState();
    state.achievements = Object.keys(ACHIEVEMENT_DEFS);
    const result = getAchievementsWithDefs(state);
    assert.equal(result.length, Object.keys(ACHIEVEMENT_DEFS).length);
    for (const entry of result) {
      assert.ok(typeof entry.label === "string" && entry.label.length > 0, `empty label for ${entry.key}`);
    }
  });

  it("reflects achievements earned via recordGoalSet with correct metadata", () => {
    const state = createInitialState();
    recordGoalSet(state, "bhag");
    const result = getAchievementsWithDefs(state);
    assert.deepEqual(result, [
      { key: "xp:bhag_set", label: "Dream Defined",  desc: "Set your Big Hairy Audacious Goal" },
      { key: "level:2",     label: "Horizon Set",    desc: "Reached Level 2" },
    ]);
  });
});
