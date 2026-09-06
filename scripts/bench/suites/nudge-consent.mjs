#!/usr/bin/env node
// =============================================================================
// nudge-consent — nobody is ever texted who did not agree to be.
//
// config/benchmarks/nudge-consent.json — gate, no `requires`: the sweep runs
// in-process against an in-memory, Prisma-shaped store
// (scripts/bench/harness/nudge-store.ts), so the whole matrix costs a second
// and needs no database.
//
// The system under test is the REAL `runNudges` + the REAL `sendPolicySms`,
// over the committed synthetic cohort with fuzzed consent state and every
// combination of the two pilot flags. The ORACLE lives here, written
// independently and in plain terms:
//
//     a text may go out only when BOTH pilot flags admit one of the student's
//     active classes, the preference row is enabled, has a number, has
//     `smsConsentAt` stamped and `smsRevokedAt` clear, the local clock is
//     inside the send window, and the recipient is under the daily cap.
//
//   ineligible_selected  texts that went to somebody the oracle refuses.  0
//   eligible_missed      texts the oracle allows that never went out.     0
//
// The second one is not decoration. A consent gate that refuses everybody
// passes the first metric perfectly, and a feature that has quietly stopped
// texting anyone is the exact failure the F63 probe exists for — measured
// against a control run of the same fixture with every gate satisfied, so
// "should have been texted" is established by the code itself rather than
// asserted.
//
// One thing this suite deliberately does NOT gate: a reply-expecting question
// sent to a handset two students share. The program does send those, and that
// is the documented 2026-09-05 decision — both students consented individually
// — with the safety living at the reply end instead, where an ambiguous "Y" is
// applied to nobody (gated by nudge-attribution). It is reported here as
// `shared_phone_questions_sent`, floor null, so the number is visible.
//
//   node --import tsx scripts/bench/suites/nudge-consent.mjs --self-test
// =============================================================================

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCohort } from "../lib/cohort.mjs";
import { createRng } from "../lib/prng.mjs";
import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const HARNESS = path.join(REPO_ROOT, "scripts", "bench", "harness", "nudge-consent.ts");

/** The 16 consent states, in a fixed order so the seeded walk is stable. */
const CONSENT_STATES = [];
for (const enabled of [true, false]) {
  for (const hasDestination of [true, false]) {
    for (const hasConsent of [true, false]) {
      for (const revoked of [false, true]) {
        CONSENT_STATES.push({ enabled, hasDestination, hasConsent, revoked });
      }
    }
  }
}

function phoneFor(base, index) {
  return `${base}${String(100 + index).padStart(4, "0")}`;
}

/**
 * The scope vocabulary, restated here on purpose.
 *
 * `parseConnectScope` in production turns a config string into a scope; this
 * turns the fixture's shorthand into the same thing plus the plain membership
 * test. Independent of the production parser, so a change to either side shows
 * up as a disagreement rather than as two copies of one bug.
 */
export function scopeAdmits(spec, classId, classIds) {
  if (spec === "off") return false;
  if (spec === "all") return true;
  const indexes = spec.replace("class:", "").split(",").map(Number);
  return indexes.some((index) => classIds[index] === classId);
}

/** The local hour, via a formatting path the policy does not use. */
export function localHour(iso, timeZone) {
  const text = new Date(iso).toLocaleString("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" });
  return Number(text.match(/\d{2}/)[0]);
}

/** The oracle. Plain, total, and the artifact a reviewer actually checks. */
export function isEligible(pref, classId, scenario, policy) {
  if (!scopeAdmits(scenario.connectScope, classId, policy.classIds)) return false;
  if (!scopeAdmits(scenario.smsScope, classId, policy.classIds)) return false;
  if (!pref.enabled) return false;
  if (pref.destination === null) return false;
  if (!pref.hasConsent) return false;
  if (pref.revoked) return false;
  const hour = localHour(scenario.nowIso, policy.timeZone);
  if (hour < policy.windowStartHour || hour >= policy.windowEndHour) return false;
  if (pref.sentToday >= policy.dailyCap) return false;
  return true;
}

/** Build the per-scenario preference rows the harness will seed. */
export function buildPreferences(kind, students, fixture, rng) {
  return students.map((student, index) => {
    const phone = phoneFor(fixture.phoneBase, index);
    if (kind === "all_valid") {
      return { studentId: student.id, enabled: true, destination: phone, hasConsent: true, revoked: false, sentToday: 0 };
    }
    if (kind === "capped") {
      return {
        studentId: student.id,
        enabled: true,
        destination: phone,
        hasConsent: true,
        revoked: false,
        // 0, 1 or 2 already sent today, so the boundary is crossed in both
        // directions inside one scenario.
        sentToday: index % 3,
      };
    }
    if (kind === "shared_phones") {
      return {
        studentId: student.id,
        enabled: true,
        // Pairs share one handset: 0 and 1, 2 and 3, and so on.
        destination: phoneFor(fixture.phoneBase, Math.floor(index / 2) * 2),
        hasConsent: true,
        revoked: false,
        sentToday: 0,
      };
    }
    if (kind === "fuzzed") {
      const state = CONSENT_STATES[Math.floor(rng() * CONSENT_STATES.length)];
      return {
        studentId: student.id,
        enabled: state.enabled,
        destination: state.hasDestination ? phone : null,
        hasConsent: state.hasConsent,
        revoked: state.revoked,
        sentToday: 0,
      };
    }
    throw new Error(`unknown preference generator "${kind}"`);
  });
}

export async function run(ctx) {
  const fixture = ctx.fixture;
  const cohort = loadCohort();
  const policyModule = await import("../../../src/lib/nudges/sms-policy-shared.ts");
  const { SMS_TIME_ZONE, SMS_DAILY_CAP, QUIET_HOURS_START_HOUR, QUIET_HOURS_END_HOUR } = policyModule;

  const students = cohort.students.map((student) => ({ id: student.id, classId: student.classId }));
  const classIds = cohort.classes.map((entry) => entry.id);
  const policy = {
    classIds,
    timeZone: SMS_TIME_ZONE,
    dailyCap: SMS_DAILY_CAP,
    windowStartHour: QUIET_HOURS_END_HOUR,
    windowEndHour: QUIET_HOURS_START_HOUR,
  };

  const rng = createRng(fixture.seed);
  const scenarios = fixture.scenarios.map((scenario) => ({
    id: scenario.id,
    connectScope: scenario.connectScope,
    smsScope: scenario.smsScope,
    nowIso: fixture.clocks[scenario.clock],
    preferenceKind: scenario.preferences,
    preferences: buildPreferences(scenario.preferences, students, fixture, rng),
  }));

  const scopeString = (spec) =>
    spec === "off" || spec === "all"
      ? spec === "off"
        ? ""
        : "all"
      : spec
          .replace("class:", "")
          .split(",")
          .map((index) => classIds[Number(index)])
          .join(",");

  const spec = {
    students,
    employerName: fixture.employerName,
    jobTitle: fixture.jobTitle,
    startedDaysAgo: fixture.startedDaysAgo,
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      connectScope: scopeString(scenario.connectScope),
      smsScope: scopeString(scenario.smsScope),
      nowIso: scenario.nowIso,
      preferences: scenario.preferences,
    })),
  };

  const child = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", HARNESS],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, BENCH_NUDGE_SPEC: JSON.stringify(spec) },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (child.status !== 0) {
    throw new Error(`nudge-consent harness exited ${child.status}\n${child.stderr || child.stdout}`);
  }
  const lastLine = child.stdout.trim().split("\n").filter(Boolean).pop();
  let payload;
  try {
    payload = JSON.parse(lastLine ?? "");
  } catch {
    throw new Error(`nudge-consent harness produced unparseable stdout:\n${child.stdout}`);
  }

  const byScenario = new Map(payload.observations.map((entry) => [entry.scenario, entry]));
  const classOf = new Map(students.map((student) => [student.id, student.classId]));
  // Offenders are reported by cohort INDEX, never by id: `details` is written
  // to a committed result file, and "no student identifiers in details" is a
  // rule about the shape of the file, not about whether these ids are real.
  const indexOf = new Map(students.map((student, index) => [student.id, index]));

  const control = byScenario.get("control");
  if (!control) throw new Error("the fixture has no `control` scenario to establish the candidate set");
  const candidates = new Set(control.sent);
  if (candidates.size !== students.length) {
    throw new Error(
      `the control run texted ${candidates.size} of ${students.length} students; ` +
        "the corpus is no longer exercising the rule this suite measures",
    );
  }

  const violations = { ineligible: [], missed: [] };
  let decisions = 0;
  let sends = 0;
  let sharedPhoneQuestions = 0;

  for (const scenario of scenarios) {
    const observation = byScenario.get(scenario.id);
    if (!observation) throw new Error(`the harness returned nothing for scenario ${scenario.id}`);
    const sent = new Set(observation.sent);
    sends += sent.size;
    if (scenario.preferenceKind === "shared_phones") sharedPhoneQuestions += sent.size;

    for (const pref of scenario.preferences) {
      decisions += 1;
      const classId = classOf.get(pref.studentId);
      const eligible = isEligible(pref, classId, scenario, policy);
      const wasSent = sent.has(pref.studentId);
      if (wasSent && !eligible) {
        violations.ineligible.push({
          scenario: scenario.id,
          student: indexOf.get(pref.studentId),
          state: {
            enabled: pref.enabled,
            hasNumber: pref.destination !== null,
            hasConsent: pref.hasConsent,
            revoked: pref.revoked,
            sentToday: pref.sentToday,
          },
        });
      }
      if (!wasSent && eligible && candidates.has(pref.studentId)) {
        violations.missed.push({ scenario: scenario.id, student: indexOf.get(pref.studentId) });
      }
    }
  }

  const shared = {
    scenarios: scenarios.length,
    students: students.length,
    sends,
    perScenario: payload.observations.map((entry) => ({
      scenario: entry.scenario,
      skipped: entry.skipped,
      planned: entry.textsPlanned,
      sent: entry.textsSent,
      outcomes: entry.textOutcomes,
    })),
  };

  return {
    metrics: [
      {
        id: "ineligible_selected",
        value: violations.ineligible.length,
        n: decisions,
        details: { ...shared, offenders: violations.ineligible.slice(0, 20) },
      },
      {
        id: "eligible_missed",
        value: violations.missed.length,
        n: decisions,
        details: { candidateSet: candidates.size, offenders: violations.missed.slice(0, 20) },
      },
      {
        id: "shared_phone_questions_sent",
        value: sharedPhoneQuestions,
        n: students.length,
        details: {
          decision:
            "2026-09-05: both students on a shared handset consented individually, so the question is sent; " +
            "an ambiguous reply is applied to nobody (gated by nudge-attribution). Reported, not gated.",
        },
      },
      {
        id: "decisions_evaluated",
        value: decisions,
        n: decisions,
        details: { consentStates: CONSENT_STATES.length },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
