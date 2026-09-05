#!/usr/bin/env node
// =============================================================================
// cohort-simulation — twelve weeks of the placement funnel, before a real
// cohort lives through them.
//
// The cohort's 20 connections are driven day by day from `meta.epoch` through
// the REAL state machine (`transitionConnection`, with the same Prisma-shaped
// fake `pipeline.test.ts` uses) and the REAL nudge selectors
// (`src/lib/nudges/schedule-shared.ts`), with the sends gated by the REAL send
// policy (`canSendSms`). Nothing about the rules is restated here; what this
// file supplies is a clock and a world that answers.
//
//   illegal_transitions            moves the machine should not have taken.  0
//   retention_checkpoint_mismatches checkpoints that came due and were never
//                                  asked.                                    0
//   retention_checkpoints_raised   how many were asked (the count itself).
//   students_stuck_over_30_days    students with a connection that has not
//                                  moved in 30 simulated days.
//   simulated_weeks                what was actually run.
//
// WHY A SIMULATION AND NOT MORE UNIT TESTS. Every rule here already has unit
// tests, and `connection-walks` already replays the state machine. What none of
// them can answer is whether the rules COMPOSE over time: whether a connection
// that stalls at `sent` is noticed, whether a student who never answers the
// day-30 text still reaches day 60, whether the daily cap silently starves the
// retention chain. Those are properties of a sequence, and the only cheap way
// to see them is to run one.
//
// The retention check is deliberately COVERAGE, not a second copy of
// `selectRetentionChecks`: "this checkpoint came due and its whole re-ask
// window passed with no ask" is derivable from the simulation's own ledger,
// while restating the selector's dedupe rules would just make the benchmark
// agree with itself.
//
//   node scripts/bench/suites/cohort-simulation.mjs --self-test
// =============================================================================

import { loadCohort } from "../lib/cohort.mjs";
import { createRng } from "../lib/prng.mjs";
import { selfTest } from "../lib/self-test.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses the employer has been sent something in and has not answered. */
const AWAITING_EMPLOYER = ["sent", "viewed"];

/** The job already happened; the simulated instructor stops closing these. */
const POST_HIRE = ["hired", "started", "retained_30", "retained_60", "retained_90"];

export async function run(ctx) {
  const {
    ALLOWED_TRANSITIONS,
    STUDENT_ALLOWED_TRANSITIONS,
    isTerminalConnectionStatus,
    transitionConnection,
  } = await import("../../../src/lib/connect/pipeline.ts");
  const { createWalkingConnectionClient } = await import(
    "../../../src/lib/connect/pipeline-fake-client.ts"
  );
  const {
    RETENTION_DAYS,
    RETENTION_REASK_DAYS,
    buildRetentionTemplateKey,
    selectEmployerNoResponse,
    selectEmployerNoView,
    selectInterviewConfirmations,
    selectRetentionChecks,
  } = await import("../../../src/lib/nudges/schedule-shared.ts");
  const { canSendSms, zonedDayKey } = await import(
    "../../../src/lib/nudges/sms-policy-shared.ts"
  );

  const fixture = ctx.fixture;
  const cohort = loadCohort();
  const rng = createRng(fixture.seed);
  const epoch = new Date(cohort.meta.epoch);
  const probability = fixture.probabilities;

  const consentedAt = new Date(
    epoch.getTime() - fixture.smsPreference.consentedDaysBeforeEpoch * DAY_MS,
  );

  // --- The world -------------------------------------------------------
  //
  // One live row per cohort connection, each with its own walking client so
  // the guarded update moves it exactly as Postgres would.
  const world = cohort.connections.map((connection, index) => ({
    id: connection.id,
    studentId: connection.studentId,
    employerName: connection.employerName ?? "the employer",
    jobTitle: connection.jobTitle ?? "the job",
    client: createWalkingConnectionClient({
      id: connection.id,
      // Every connection restarts at `proposed`: the point is the whole
      // twelve weeks, and starting mid-funnel would leave the early rules
      // (student approval, the send, the employer's first look) unexercised
      // for those rows.
      status: "proposed",
      studentId: connection.studentId,
    }),
    sentAt: null,
    lastViewAt: null,
    startedAt: null,
    interviewStartsAt: null,
    interviewAppointmentId: null,
    interviewPlace: null,
    sentMessages: [],
    openAlertTypes: [],
    lastMovedDay: 0,
    /** Day the row entered each retention-eligible status, for the coverage check. */
    enteredStatusOnDay: { proposed: 0 },
    seedIndex: index,
  }));

  const byId = new Map(world.map((row) => [row.id, row]));
  const smsSentOnDay = new Map();

  let illegalTransitions = 0;
  const illegalExamples = [];
  let checkpointsRaised = 0;
  let alertsRaised = 0;
  let textsSent = 0;
  let textsRefused = 0;

  /**
   * Drive one move and account for it.
   *
   * A move the machine refuses, or one it accepts without the row landing on
   * the requested status, is an illegal transition — the simulation only ever
   * draws from the machine's own table, so either is the machine disagreeing
   * with itself.
   */
  async function move(row, to, actorType, actorId = null) {
    const from = row.client.currentStatus();
    try {
      await transitionConnection({
        connectionId: row.id,
        to,
        actorType,
        actorId,
        client: row.client,
      });
    } catch (error) {
      illegalTransitions += 1;
      if (illegalExamples.length < 20) {
        illegalExamples.push({ from, to, actorType, refused: String(error?.name ?? error) });
      }
      return false;
    }
    if (row.client.currentStatus() !== to) {
      illegalTransitions += 1;
      if (illegalExamples.length < 20) {
        illegalExamples.push({ from, to, actorType, reason: "row did not move" });
      }
      return false;
    }
    return true;
  }

  /** A `ConnectionSnapshot`, exactly the shape the runner's query builds. */
  function snapshotOf(row) {
    return {
      id: row.id,
      studentId: row.studentId,
      employerName: row.employerName,
      jobTitle: row.jobTitle,
      status: row.client.currentStatus(),
      sentAt: row.sentAt,
      lastViewAt: row.lastViewAt,
      startedAt: row.startedAt,
      interviewStartsAt: row.interviewStartsAt,
      interviewAppointmentId: row.interviewAppointmentId,
      interviewPlace: row.interviewPlace,
      sentMessages: row.sentMessages,
      openAlertTypes: row.openAlertTypes,
    };
  }

  /**
   * Try to send one planned text through the real policy and the real cap.
   * Returns true when it went out.
   *
   * The per-day counter is keyed by `zonedDayKey`, the product's own notion of
   * "a local day", rather than by a UTC date. The cap is two per RECIPIENT per
   * LOCAL day, and a UTC key would move the boundary by four or five hours and
   * quietly let a third text through on one day a year.
   */
  function trySend(plan, now) {
    const row = byId.get(plan.connectionId);
    const dayKey = `${plan.studentId}:${zonedDayKey(now)}`;
    const sentToday = smsSentOnDay.get(dayKey) ?? 0;
    const decision = canSendSms({
      pref: {
        enabled: fixture.smsPreference.enabled,
        destination: `${fixture.smsPreference.destinationPrefix}${String(
          (row?.seedIndex ?? 0) % 100,
        ).padStart(2, "0")}`,
        smsConsentAt: consentedAt,
        smsRevokedAt: null,
      },
      now,
      sentTodayCount: sentToday,
    });
    if (decision.decision !== "allow") {
      textsRefused += 1;
      return false;
    }
    smsSentOnDay.set(dayKey, sentToday + 1);
    textsSent += 1;

    if (row) {
      row.sentMessages = [
        ...row.sentMessages,
        { templateKey: plan.templateKey, sentAt: now, status: "sent" },
      ];
    }
    return true;
  }

  // --- Twelve weeks, one day at a time ---------------------------------
  const days = fixture.weeks * 7;

  for (let day = 1; day <= days; day += 1) {
    const now = new Date(epoch.getTime() + day * DAY_MS);
    now.setUTCHours(fixture.tickHourUtc, 0, 0, 0);

    // 1. The world answers. Every advance goes through the real machine, with
    //    the actor the product would use: the student approves, the instructor
    //    sends and closes, the employer answers.
    for (const row of world) {
      const status = row.client.currentStatus();
      if (isTerminalConnectionStatus(status)) continue;

      let moved = false;

      if (status === "proposed" && rng.chance(probability.studentApproves)) {
        moved = await move(row, "student_approved", "student", row.studentId);
      } else if (status === "student_approved" && rng.chance(probability.instructorSends)) {
        moved = await move(row, "sent", "teacher");
        if (moved) row.sentAt = now;
      } else if (status === "sent" && rng.chance(probability.employerViews)) {
        moved = await move(row, "viewed", "employer");
        if (moved) row.lastViewAt = now;
      } else if (AWAITING_EMPLOYER.includes(status) && rng.chance(probability.employerAnswers)) {
        moved = await move(row, "interested", "employer");
      } else if (status === "interested" && rng.chance(probability.employerAnswers)) {
        moved = await move(row, "interview_scheduled", "employer");
        if (moved) {
          // Tomorrow, so the 24-hour reminder rule has something to find.
          row.interviewStartsAt = new Date(now.getTime() + DAY_MS * 0.75);
          row.interviewAppointmentId = `${row.id}-appt-${day}`;
          row.interviewPlace = "the shop";
        }
      } else if (status === "interview_scheduled" && rng.chance(probability.employerHires)) {
        moved = await move(row, "hired", "employer");
      } else if (status === "hired" && rng.chance(probability.startsWork)) {
        moved = await move(row, "started", "system");
        if (moved) row.startedAt = now;
      } else if (!POST_HIRE.includes(status) && rng.chance(probability.staffCloses)) {
        // Pre-hire only. A close is legal from every non-terminal status, but
        // applying it to a placement every day for twelve weeks would end the
        // retention chain before it ever reached day 60 — the simulation would
        // then report a clean funnel because nothing lived long enough to fail.
        moved = await move(row, "closed", "teacher");
      }

      if (moved) {
        row.lastMovedDay = day;
        const next = row.client.currentStatus();
        if (row.enteredStatusOnDay[next] === undefined) row.enteredStatusOnDay[next] = day;
      }
    }

    // 2. What the runner would notice today. The selectors are the product's,
    //    unmodified; the snapshots are what the runner's query would build.
    const snapshots = world.map((row) => snapshotOf(row, now));

    for (const plan of [
      ...selectEmployerNoView(snapshots, now),
      ...selectEmployerNoResponse(snapshots, now),
    ]) {
      const row = byId.get(plan.sourceId);
      if (!row || row.openAlertTypes.includes(plan.type)) continue;
      row.openAlertTypes = [...row.openAlertTypes, plan.type];
      alertsRaised += 1;
    }

    const retention = selectRetentionChecks(snapshots, now);
    for (const plan of retention.alerts) {
      const row = byId.get(plan.sourceId);
      if (!row || row.openAlertTypes.includes(plan.type)) continue;
      row.openAlertTypes = [...row.openAlertTypes, plan.type];
      alertsRaised += 1;
    }

    // 3. Today's texts, through the real policy. Interview reminders first:
    //    a reminder that arrives after the interview is worthless, while a
    //    retention question is fine tomorrow.
    for (const plan of selectInterviewConfirmations(snapshots, now)) {
      trySend(plan, now);
    }
    for (const plan of retention.texts) {
      if (!trySend(plan, now)) continue;
      checkpointsRaised += 1;

      // 4. The student answers, or does not. A "yes" advances the funnel
      //    through the real machine; a "no" ends it. Silence leaves the
      //    connection where it is, which is what makes the re-ask and the
      //    unanswered alert reachable at all.
      if (!rng.chance(probability.repliesToRetention)) continue;
      const row = byId.get(plan.connectionId);
      if (!row) continue;

      if (rng.chance(probability.retentionReplyIsYes)) {
        // A SYSTEM write, not a student one. The reply is evidence; the status
        // change is the program's, and STUDENT_ALLOWED_TRANSITIONS is empty
        // post-hire on purpose (a student must not be able to rewrite a
        // verified placement from a text message). Driving it as the student
        // here would be the simulation asking for a move the product forbids.
        const next = `retained_${plan.day}`;
        if (await move(row, next, "system")) {
          row.lastMovedDay = day;
          if (row.enteredStatusOnDay[next] === undefined) row.enteredStatusOnDay[next] = day;
        }
      } else if (await move(row, "closed", "teacher")) {
        row.lastMovedDay = day;
      }
    }
  }

  // --- Retention coverage ----------------------------------------------
  //
  // For each checkpoint: the row sat in the status that owes that question,
  // long enough for the checkpoint AND a whole re-ask window to pass, and was
  // never asked. That is the shape of the bug the retention chain already had.
  const owedStatusForDay = { 30: "started", 60: "retained_30", 90: "retained_60" };
  let mismatches = 0;
  const mismatchExamples = [];

  for (const row of world) {
    for (const checkpointDay of RETENTION_DAYS) {
      const owedStatus = owedStatusForDay[checkpointDay];
      const enteredOn = row.enteredStatusOnDay[owedStatus];
      if (enteredOn === undefined) continue;

      const leftOn = leftStatusOnDay(row, owedStatus, days);
      const dueOn = enteredOn + checkpointDay + fixture.expectations.reaskGraceDays;
      if (leftOn < dueOn) continue; // it moved on before the window closed

      const asked = row.sentMessages.some(
        (message) => message.templateKey === buildRetentionTemplateKey(checkpointDay),
      );
      if (asked) continue;

      mismatches += 1;
      if (mismatchExamples.length < 20) {
        mismatchExamples.push({
          checkpointDay,
          owedStatus,
          enteredOn,
          leftOn,
          reaskWindowDays: RETENTION_REASK_DAYS,
        });
      }
    }
  }

  /** The day the row moved out of `status`, or the last day if it never did. */
  function leftStatusOnDay(row, status, lastDay) {
    const order = ["started", "retained_30", "retained_60", "retained_90"];
    const index = order.indexOf(status);
    for (let next = index + 1; next < order.length; next += 1) {
      const entered = row.enteredStatusOnDay[order[next]];
      if (entered !== undefined) return entered;
    }
    // Terminal exits (`closed`, `withdrawn`) end the obligation too.
    for (const terminal of ["closed", "withdrawn", "not_now"]) {
      const entered = row.enteredStatusOnDay[terminal];
      if (entered !== undefined) return entered;
    }
    return lastDay;
  }

  // --- Stalled students -------------------------------------------------
  const stuckStudents = new Map();
  for (const row of world) {
    const status = row.client.currentStatus();
    if (isTerminalConnectionStatus(status)) continue;
    const idleDays = days - row.lastMovedDay;
    if (idleDays <= fixture.stuckDays) continue;
    const worst = stuckStudents.get(row.studentId);
    if (!worst || idleDays > worst.idleDays) {
      stuckStudents.set(row.studentId, { status, idleDays });
    }
  }

  // A tally rather than a list of students: the result file is committed, and
  // "eight students stalled at `sent`" is the number a job developer acts on.
  const stuckByStatus = {};
  for (const entry of stuckStudents.values()) {
    stuckByStatus[entry.status] = (stuckByStatus[entry.status] ?? 0) + 1;
  }

  const finalStatuses = {};
  for (const row of world) {
    const status = row.client.currentStatus();
    finalStatuses[status] = (finalStatuses[status] ?? 0) + 1;
  }

  return {
    metrics: [
      {
        id: "illegal_transitions",
        value: illegalTransitions,
        n: world.length * days,
        details: { examples: illegalExamples },
      },
      {
        id: "retention_checkpoint_mismatches",
        value: mismatches,
        n: world.length * RETENTION_DAYS.length,
        details: { examples: mismatchExamples, reaskWindowDays: RETENTION_REASK_DAYS },
      },
      {
        id: "retention_checkpoints_raised",
        value: checkpointsRaised,
        n: world.length,
        details: { alertsRaised, textsSent, textsRefused },
      },
      {
        id: "students_stuck_over_30_days",
        value: stuckStudents.size,
        n: new Set(world.map((row) => row.studentId)).size,
        details: { byStatus: stuckByStatus, thresholdDays: fixture.stuckDays },
      },
      {
        id: "simulated_weeks",
        value: fixture.weeks,
        n: world.length,
        details: {
          epoch: cohort.meta.epoch,
          finalStatuses,
          transitionTable: Object.fromEntries(
            Object.entries(ALLOWED_TRANSITIONS).map(([from, tos]) => [from, tos.length]),
          ),
          studentTableSize: Object.values(STUDENT_ALLOWED_TRANSITIONS).flat().length,
        },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
