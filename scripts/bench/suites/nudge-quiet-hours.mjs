#!/usr/bin/env node
// =============================================================================
// nudge-quiet-hours — the send window and the daily cap, over a whole year.
//
// config/benchmarks/nudge-quiet-hours.json — gate, no `requires`: everything
// under test is a pure function of a preference snapshot, a clock and a count
// (src/lib/nudges/sms-policy-shared.ts), so a year of decisions costs a second
// and needs neither a database nor a network.
//
// Four counters, all floor 0 and all `exact`:
//
//   outside_window_sends     "allow" at a local hour outside [08:00, 21:00)
//   cap_violations           "allow" when the recipient is already at the cap
//   deferral_outside_window  a deferral whose `until` is not local 08:00
//   deferral_not_in_future   a deferral whose `until` is at or before `now`
//
// The last two are where DST actually bites. `nextSendWindowStart` has to name
// 08:00 LOCAL on all 365 days; an implementation that advanced the clock by
// adding 24 hours to the UTC instant is right on 363 of them and an hour out on
// 2026-03-08 and 2026-11-01 — a text at 07:00 on a Sunday in March, found by
// nobody until someone gets it.
//
// The oracle is deliberately a different formatting path from the production
// helper: `Date#toLocaleString` with `hourCycle: "h23"` here versus
// `Intl.DateTimeFormat#formatToParts` in `zonedHour`. Scoring the policy with
// its own clock would make any bug in that clock invisible.
//
//   node --import tsx scripts/bench/suites/nudge-quiet-hours.mjs --self-test
// =============================================================================

import { selfTest } from "../lib/self-test.mjs";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The local wall clock, via a formatting path the policy does not use.
 *
 * `toLocaleString` with an explicit `hourCycle` rather than `hour12: false`,
 * which some ICU versions render midnight as "24" under — the production
 * helper carries its own `% 24` for exactly that reason, and an oracle that
 * copied the workaround would also copy any mistake in it.
 */
export function localParts(at, timeZone) {
  const text = at.toLocaleString("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`unparseable local time for ${at.toISOString()}: ${text}`);
  return {
    month: Number(match[1]),
    day: Number(match[2]),
    year: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    dayKey: `${match[3]}-${match[1]}-${match[2]}`,
  };
}

/**
 * Judge one decision. Pure, exported, and the thing the red-first unit test
 * drives with a synthetic decision that IS wrong — a counter that has never
 * been seen to rise is not a counter.
 *
 * @param {{ at: Date, sentTodayCount: number, decision: object }} sample
 * @param {{ timeZone: string, windowStartHour: number, windowEndHour: number, dailyCap: number }} policy
 */
export function classifyDecision(sample, policy) {
  const { at, sentTodayCount, decision } = sample;
  const { timeZone, windowStartHour, windowEndHour, dailyCap } = policy;
  const local = localParts(at, timeZone);
  const insideWindow = local.hour >= windowStartHour && local.hour < windowEndHour;
  const violations = [];

  if (decision.decision === "allow") {
    if (!insideWindow) {
      violations.push({ kind: "outside_window_sends", localHour: local.hour, at: at.toISOString() });
    }
    if (sentTodayCount >= dailyCap) {
      violations.push({ kind: "cap_violations", sentTodayCount, at: at.toISOString() });
    }
  }

  if (decision.decision === "defer") {
    const until = decision.until instanceof Date ? decision.until : new Date(decision.until);
    const untilLocal = localParts(until, timeZone);
    if (untilLocal.hour !== windowStartHour) {
      violations.push({
        kind: "deferral_outside_window",
        localHour: untilLocal.hour,
        at: at.toISOString(),
        until: until.toISOString(),
      });
    }
    if (until.getTime() <= at.getTime()) {
      violations.push({
        kind: "deferral_not_in_future",
        at: at.toISOString(),
        until: until.toISOString(),
      });
    }
  }

  return violations;
}

/** Tally a flat list of violations into the four counters plus samples. */
export function tally(violations) {
  const counts = {
    outside_window_sends: 0,
    cap_violations: 0,
    deferral_outside_window: 0,
    deferral_not_in_future: 0,
  };
  const samples = {};
  for (const violation of violations) {
    counts[violation.kind] += 1;
    if (!samples[violation.kind]) samples[violation.kind] = [];
    if (samples[violation.kind].length < 5) samples[violation.kind].push(violation);
  }
  return { counts, samples };
}

export async function run(ctx) {
  const fixture = ctx.fixture;
  const policyModule = await import("../../../src/lib/nudges/sms-policy-shared.ts");
  const {
    SMS_TIME_ZONE,
    SMS_DAILY_CAP,
    QUIET_HOURS_START_HOUR,
    QUIET_HOURS_END_HOUR,
    canSendSms,
  } = policyModule;

  // The fixture measures ONE clock because the code has one. When that stops
  // being true this line is what says so, rather than a year of decisions
  // quietly scored against the wrong zone.
  if (SMS_TIME_ZONE !== fixture.timeZone) {
    throw new Error(
      `SMS_TIME_ZONE is now ${SMS_TIME_ZONE}; the fixture measures ${fixture.timeZone}. ` +
        "If the program grew a second timezone, this suite must grow one too — see the fixture's notes.",
    );
  }

  const policy = {
    timeZone: SMS_TIME_ZONE,
    windowStartHour: QUIET_HOURS_END_HOUR,
    windowEndHour: QUIET_HOURS_START_HOUR,
    dailyCap: SMS_DAILY_CAP,
  };

  // Fully consented, so nothing but timing and the cap can refuse. A refusal
  // for any other reason would mean the corpus never reaches the code paths
  // this suite exists to measure.
  const pref = {
    enabled: true,
    destination: "+13045550100",
    smsConsentAt: new Date("2026-01-01T00:00:00.000Z"),
    smsRevokedAt: null,
  };

  const start = new Date(fixture.startUtc).getTime();
  const violations = [];
  const seenLocalDays = new Set();
  let ticks = 0;
  let allowed = 0;
  let deferred = 0;

  for (let hour = 0; hour < fixture.hours; hour += 1) {
    const at = new Date(start + hour * HOUR_MS);
    seenLocalDays.add(localParts(at, policy.timeZone).dayKey);
    for (const sentTodayCount of fixture.sentTodayCounts) {
      const decision = canSendSms({ pref, now: at, sentTodayCount });
      if (decision.decision === "allow") allowed += 1;
      if (decision.decision === "defer") deferred += 1;
      if (decision.decision === "refuse") {
        // Consent is stamped and the channel is on, so a refusal here is the
        // corpus not exercising the code under test. Loud, not silent.
        throw new Error(
          `a fully-consented recipient was refused (${decision.reason}) at ${at.toISOString()}; ` +
            "the fixture no longer reaches the timing rules",
        );
      }
      violations.push(...classifyDecision({ at, sentTodayCount, decision }, policy));
    }
    ticks += 1;
  }

  // Both DST transition days have to be in the corpus, or the two metrics that
  // only bite there are measuring nothing.
  for (const day of fixture.dstTransitionDaysLocal) {
    if (!seenLocalDays.has(day)) {
      throw new Error(`the corpus does not cover the DST transition day ${day}`);
    }
  }

  const { counts, samples } = tally(violations);
  const n = ticks * fixture.sentTodayCounts.length;
  const shared = { localDays: seenLocalDays.size, allowed, deferred };

  return {
    metrics: [
      {
        id: "outside_window_sends",
        value: counts.outside_window_sends,
        n,
        details: { ...shared, offenders: samples.outside_window_sends ?? [] },
      },
      {
        id: "cap_violations",
        value: counts.cap_violations,
        n,
        details: { dailyCap: policy.dailyCap, offenders: samples.cap_violations ?? [] },
      },
      {
        id: "deferral_outside_window",
        value: counts.deferral_outside_window,
        n: deferred,
        details: {
          windowStartHour: policy.windowStartHour,
          dstDays: fixture.dstTransitionDaysLocal,
          offenders: samples.deferral_outside_window ?? [],
        },
      },
      {
        id: "deferral_not_in_future",
        value: counts.deferral_not_in_future,
        n: deferred,
        details: { offenders: samples.deferral_not_in_future ?? [] },
      },
      {
        id: "ticks_evaluated",
        value: n,
        n,
        details: { hours: ticks, sentTodayCounts: fixture.sentTodayCounts },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
