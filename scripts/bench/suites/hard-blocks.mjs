#!/usr/bin/env node
// =============================================================================
// hard-blocks — does every block that should fire fire, and does nothing else?
//
// A hard block removes a job from a student's view entirely. Getting it wrong
// costs in both directions and neither direction raises an error:
//
//   a MISSED block  shows a student a job they cannot legally or physically do;
//   a FALSE block   hides a real job from a student, silently, forever.
//
// So both are measured, and both floors are absolute:
//
//   blocks_expected_fired — every expected (pair, code) actually fired. 1.0
//   false_blocks          — codes fired that no rule expected.            0
//
// THE EXPECTATIONS ARE RE-DERIVED, NOT BORROWED. `expectedBlocks` below
// implements the seven rules from the design spec §5 from scratch. Importing
// `collectHardBlocks` and comparing it to itself would pass unconditionally,
// including on the day the rules are wrong. Two independent implementations of
// one written rule disagreeing is exactly the signal this suite exists to
// produce; where they disagree, the SPEC decides which one is wrong.
//
// Coverage is checked too: every one of the seven codes must be exercised by at
// least one pair. A suite reporting 1.0 while three codes never ran is worse
// than no suite, because it reads as proof.
//
//   node scripts/bench/suites/hard-blocks.mjs --self-test
// =============================================================================

import { loadCohort, toMatchLead, toMatchStudent } from "../lib/cohort.mjs";
import { isSelfTest, selfTest } from "../lib/self-test.mjs";

const SUITE = "hard-blocks";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAYS = DAYS.slice(0, 5);
const WEEKEND = DAYS.slice(5);
const SLOTS = ["morning", "afternoon", "evening", "overnight"];

const SHIFT_CELLS = {
  day: WEEKDAYS.flatMap((day) => [`${day}/morning`, `${day}/afternoon`]),
  evening: WEEKDAYS.map((day) => `${day}/evening`),
  night: WEEKDAYS.map((day) => `${day}/overnight`),
  weekend: WEEKEND.flatMap((day) => SLOTS.map((slot) => `${day}/${slot}`)),
};

/** Hours per week each lead pay period represents. */
const PERIOD_HOURS = { hour: 1, day: 8, week: 40, month: 173.33, year: 2080 };

const MAX_WALKING_MILES = 2;

/**
 * The salary parser refuses an implausible hourly rate rather than passing a
 * wrong number to a hard block. Restated here as the same band the product
 * uses, because a lead whose normalized rate falls outside it comes back null —
 * "unknown" — and unknown never blocks.
 */
const PLAUSIBLE_HOURLY = { min: 2, max: 500 };

function hasAnyAvailability(grid) {
  return DAYS.some((day) => SLOTS.some((slot) => grid?.[day]?.[slot]));
}

function hourly(amount, period) {
  if (amount === null || amount === undefined) return null;
  const rate = amount / (PERIOD_HOURS[period] ?? 1);
  if (rate < PLAUSIBLE_HOURLY.min || rate > PLAUSIBLE_HOURLY.max) return null;
  return rate;
}

/**
 * The seven hard blocks, from the design spec §5, re-implemented.
 *
 * Every one requires a POSITIVE fact. Missing data — no profile, an untouched
 * availability grid, a lead that names no shift, no stated pay, no recorded
 * transport — never blocks. That asymmetry is the whole rule, so it is written
 * out here rather than inherited.
 */
function expectedBlocks(student, profile, lead, withdrawnEmployerIds) {
  const blocks = [];

  if (lead.status !== "open") blocks.push("lead_not_open");
  if (lead.employerStatus === "do_not_contact") blocks.push("employer_do_not_contact");
  if (withdrawnEmployerIds.includes(lead.employerId)) {
    blocks.push("student_withdrew_from_employer");
  }

  // Availability: only a DECLARED grid against a NAMED shift, with nothing at
  // all in common.
  const shifts = [...new Set(lead.schedule.shifts ?? [])];
  if (shifts.length > 0 && profile && hasAnyAvailability(profile.availability)) {
    const cells = shifts.flatMap((shift) => SHIFT_CELLS[shift] ?? []);
    const covered = cells.filter((cell) => {
      const [day, slot] = cell.split("/");
      return Boolean(profile.availability[day]?.[slot]);
    }).length;
    if (cells.length > 0 && covered === 0) blocks.push("availability_no_overlap");
  }

  // Certifications: VERIFIED only. A self-reported card does not clear a
  // must-have, because the employer will ask to see it.
  const missing = (lead.requirements.mustHaveCerts ?? []).filter(
    (certId) => !student.verifiedCertIds.includes(certId),
  );
  if (missing.length > 0) blocks.push("missing_must_have_cert");

  // Pay: the TOP of the range decides. A $12-$18 job clears a $15 floor.
  const floor = profile?.payFloorHourly ?? null;
  if (floor !== null) {
    const best = hourly(lead.payMax, lead.payPeriod) ?? hourly(lead.payMin, lead.payPeriod);
    if (best !== null && best < floor) blocks.push("pay_below_floor");
  }

  // Transport: a named transit route settles it for everyone, whatever the
  // student answered. Only `walk` past the walking distance and `none` with no
  // route are hard noes.
  const hasRoute = Boolean(lead.transitNotes && lead.transitNotes.trim());
  const transport = profile?.transport ?? null;
  if (!hasRoute && transport) {
    if (transport === "none") blocks.push("transport_infeasible");
    if (
      transport === "walk" &&
      lead.distanceMiles !== null &&
      lead.distanceMiles !== undefined &&
      lead.distanceMiles > MAX_WALKING_MILES
    ) {
      blocks.push("transport_infeasible");
    }
  }

  return blocks;
}

export async function run(ctx) {
  const { fit } = await import("../../../src/lib/connect/matching-shared.ts");

  const cohort = loadCohort();
  const withdrawalsByStudent = new Map(
    (ctx.fixture.withdrawals ?? []).map((row) => [row.studentId, row.employerIds]),
  );

  let expectedTotal = 0;
  let expectedFired = 0;
  const missed = [];
  const falseBlocks = [];
  const codesSeen = new Set();

  for (const student of cohort.students) {
    const profile = cohort.workProfileByStudentId.get(student.id) ?? null;
    const withdrawn = withdrawalsByStudent.get(student.id) ?? [];
    const matchStudent = { ...toMatchStudent(cohort, student), withdrawnEmployerIds: [...withdrawn] };

    for (const lead of cohort.leads) {
      const expected = new Set(expectedBlocks(student, profile, lead, withdrawn));
      const actual = new Set(fit(matchStudent, toMatchLead(lead)).hardBlocks);
      for (const code of actual) codesSeen.add(code);

      for (const code of expected) {
        expectedTotal += 1;
        if (actual.has(code)) {
          expectedFired += 1;
        } else if (missed.length < 20) {
          missed.push({ studentId: student.id, leadId: lead.id, code });
        }
      }
      for (const code of actual) {
        if (!expected.has(code)) {
          falseBlocks.push({ studentId: student.id, leadId: lead.id, code });
        }
      }
    }
  }

  // Coverage. A perfect score over four of seven codes is not a pass, so an
  // unexercised code is reported as a false block against the fixture: the
  // fixture is what failed, and it must be loud rather than quietly absent.
  const required = ctx.fixture.expectEveryCodeExercised ?? [];
  const unexercised = required.filter((code) => !codesSeen.has(code));

  return {
    metrics: [
      {
        id: "blocks_expected_fired",
        value: expectedTotal === 0 ? 0 : Number((expectedFired / expectedTotal).toFixed(4)),
        n: expectedTotal,
        details: { missed, codesExercised: [...codesSeen].sort(), unexercised },
      },
      {
        id: "false_blocks",
        // An unexercised code counts here: the suite claimed to measure seven
        // rules and measured fewer, which is a defect in the same direction as
        // a wrong block — a result that reads as proof and is not.
        value: falseBlocks.length + unexercised.length,
        n: cohort.students.length * cohort.leads.length,
        details: { falseBlocks: falseBlocks.slice(0, 20), unexercised },
      },
    ],
  };
}

if (isSelfTest(import.meta.url)) await selfTest(SUITE, run);
