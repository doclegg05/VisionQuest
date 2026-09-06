import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPLOYER_NO_RESPONSE_DAYS,
  EMPLOYER_NO_VIEW_DAYS,
  HEARD_BACK_DAYS,
  INTERVIEW_LOOKAHEAD_HOURS,
  NUDGE_ALERT_TYPES,
  RETENTION_DAYS,
  RETENTION_REASK_DAYS,
  WEEKLY_NUDGE_HOUR_ET,
  WEEKLY_NUDGE_LOOKBACK_DAYS,
  buildRetentionTemplateKey,
  heardBackTemplateKey,
  interviewDeclineAckTemplateKey,
  interviewTemplateKey,
  isWeeklyNudgeSlot,
  parseReplyToken,
  replyToken,
  selectDeferredInterviewAcks,
  selectEmployerNoResponse,
  selectEmployerNoView,
  selectHeardBackChecks,
  selectInterviewConfirmations,
  selectRetentionChecks,
  selectWeeklyJobsRecipients,
  type ConnectionSnapshot,
  type SavedJobSnapshot,
  type WeeklyCandidate,
} from "./schedule-shared";

const NOW = new Date("2026-09-08T14:00:00Z"); // Tuesday 10:00 EDT

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function connection(overrides: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot {
  return {
    id: "con_1",
    studentId: "stu_1",
    employerName: "Mountain Metals",
    jobTitle: "Production Associate",
    status: "sent",
    sentAt: daysBefore(4),
    lastViewAt: null,
    startedAt: null,
    interviewStartsAt: null,
    interviewAppointmentId: null,
    interviewPlace: null,
    sentMessages: [],
    openAlertTypes: [],
    ...overrides,
  };
}

/** A delivered ask of `templateKey`, `daysAgo` before NOW. */
function sent(templateKey: string, daysAgo: number, status = "sent") {
  return { templateKey, sentAt: daysBefore(daysAgo), status };
}

describe("employer-side rules write instructor alerts and never text the employer", () => {
  it("raises no-view after 3 days with no employer_viewed event", () => {
    assert.equal(EMPLOYER_NO_VIEW_DAYS, 3);
    const [alert] = selectEmployerNoView([connection()], NOW);
    assert.equal(alert.type, NUDGE_ALERT_TYPES.employerNoView);
    assert.equal(alert.studentId, "stu_1");
    assert.equal(alert.sourceId, "con_1");
    assert.equal(alert.alertKey, "connect_employer_no_view:con_1");
    assert.match(alert.summary, /Mountain Metals/);
  });

  it("stays silent before the third day, and once the employer has opened it", () => {
    assert.deepEqual(selectEmployerNoView([connection({ sentAt: daysBefore(2) })], NOW), []);
    assert.deepEqual(
      selectEmployerNoView([connection({ lastViewAt: daysBefore(1) })], NOW),
      [],
      "an opened link is not a no-view",
    );
    assert.deepEqual(
      selectEmployerNoView([connection({ status: "viewed" })], NOW),
      [],
      "a connection past 'sent' has been seen",
    );
  });

  it("raises no-response after 7 days, and says to consider re-sending rather than re-sending", () => {
    assert.equal(EMPLOYER_NO_RESPONSE_DAYS, 7);
    const stale = connection({ status: "viewed", sentAt: daysBefore(8), lastViewAt: daysBefore(7) });
    const [alert] = selectEmployerNoResponse([stale], NOW);
    assert.equal(alert.type, NUDGE_ALERT_TYPES.employerNoResponse);
    assert.match(alert.summary, /consider re-sending/i);
    assert.doesNotMatch(
      alert.summary,
      /(automatically|we re-?sent|has been re-?sent)/i,
      "nothing is ever re-sent without a person",
    );
  });

  it("stops at 'interested' — an answer is not a non-answer", () => {
    assert.deepEqual(
      selectEmployerNoResponse([connection({ status: "interested", sentAt: daysBefore(9) })], NOW),
      [],
    );
  });

  it("is idempotent: an alert already open for the rule is not raised again", () => {
    const already = connection({ openAlertTypes: [NUDGE_ALERT_TYPES.employerNoView] });
    assert.deepEqual(selectEmployerNoView([already], NOW), []);
  });

  it("does not stack no-response on top of an open no-view card", () => {
    const stale = connection({
      status: "viewed",
      sentAt: daysBefore(9),
      openAlertTypes: [NUDGE_ALERT_TYPES.employerNoView],
    });
    assert.deepEqual(selectEmployerNoResponse([stale], NOW), []);
  });

  it("never produces an employer-addressed message of any kind", () => {
    const rows = [
      ...selectEmployerNoView([connection()], NOW),
      ...selectEmployerNoResponse([connection({ sentAt: daysBefore(9) })], NOW),
    ];
    for (const row of rows) {
      assert.ok(!("body" in row), "employer rules produce alerts, never messages");
    }
  });
});

describe("interview confirmation", () => {
  const soonBase = {
    status: "interview_scheduled" as const,
    interviewAppointmentId: "appt_1",
    interviewStartsAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
  };

  it("texts once, for an interview inside the next 24 hours", () => {
    assert.equal(INTERVIEW_LOOKAHEAD_HOURS, 24);
    const [item] = selectInterviewConfirmations([connection(soonBase)], NOW);
    assert.equal(item.templateKey, interviewTemplateKey("appt_1"));
    assert.equal(item.connectionId, "con_1");
    assert.equal(item.expectsReply, replyToken({ kind: "interview_confirm", connectionId: "con_1" }));
  });

  it("tells the student where to get the address, since no page shows one", () => {
    const [item] = selectInterviewConfirmations([connection(soonBase)], NOW);
    assert.match(item.body, /Ask your teacher for the address\./);
    assert.doesNotMatch(item.body, /undefined|null/);
  });

  it("points at the appointments page when the appointment carries a location", () => {
    const [item] = selectInterviewConfirmations(
      [connection({ ...soonBase, interviewPlace: "Plant 2 front desk" })],
      NOW,
    );
    assert.match(item.body, /appointments page/);
  });

  it("skips one already texted, one further out, and one already past", () => {
    assert.deepEqual(
      selectInterviewConfirmations(
        [connection({ ...soonBase, sentMessages: [sent(interviewTemplateKey("appt_1"), 0)] })],
        NOW,
      ),
      [],
    );
    assert.deepEqual(
      selectInterviewConfirmations(
        [connection({ ...soonBase, interviewStartsAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000) })],
        NOW,
      ),
      [],
    );
    assert.deepEqual(
      selectInterviewConfirmations([connection({ ...soonBase, interviewStartsAt: daysBefore(1) })], NOW),
      [],
    );
  });

  it("re-texts when the interview is RESCHEDULED onto a new appointment", () => {
    // Keyed on the appointment, not the connection: a connection-keyed dedupe
    // would suppress the reminder for the new time.
    const moved = connection({
      ...soonBase,
      interviewAppointmentId: "appt_2",
      sentMessages: [sent(interviewTemplateKey("appt_1"), 1)],
    });
    const [item] = selectInterviewConfirmations([moved], NOW);
    assert.equal(item.templateKey, interviewTemplateKey("appt_2"));
  });

  it("does not retry within 24h of a FAILED send, and does after", () => {
    const failedNow = connection({
      ...soonBase,
      sentMessages: [sent(interviewTemplateKey("appt_1"), 0, "failed")],
    });
    assert.deepEqual(selectInterviewConfirmations([failedNow], NOW), []);

    const failedYesterday = connection({
      ...soonBase,
      sentMessages: [sent(interviewTemplateKey("appt_1"), 2, "failed")],
    });
    assert.equal(selectInterviewConfirmations([failedYesterday], NOW).length, 1);
  });
});

describe("the deferred interview-decline acknowledgement", () => {
  it("is owed while the unconfirmed alert is open and no ack has landed", () => {
    const owed = connection({
      openAlertTypes: [NUDGE_ALERT_TYPES.interviewUnconfirmed],
    });
    const [ack] = selectDeferredInterviewAcks([owed], NOW);
    assert.equal(ack.templateKey, interviewDeclineAckTemplateKey("con_1"));
    assert.equal(ack.expectsReply, null, "an acknowledgement asks nothing");
    assert.match(ack.body, /Your teacher will call you/);
  });

  it("is not owed once it has been delivered, nor without the alert", () => {
    assert.deepEqual(
      selectDeferredInterviewAcks(
        [
          connection({
            openAlertTypes: [NUDGE_ALERT_TYPES.interviewUnconfirmed],
            sentMessages: [sent(interviewDeclineAckTemplateKey("con_1"), 0)],
          }),
        ],
        NOW,
      ),
      [],
    );
    assert.deepEqual(selectDeferredInterviewAcks([connection()], NOW), []);
  });
});

describe("retention check-ins at 30, 60 and 90 days", () => {
  it("uses the days the plan names, in order", () => {
    assert.deepEqual([...RETENTION_DAYS], [30, 60, 90]);
  });

  it("asks the 30-day question 30 days after the connection STARTED", () => {
    const started = connection({ status: "started", startedAt: daysBefore(30) });
    const { texts, alerts } = selectRetentionChecks([started], NOW);
    assert.deepEqual(alerts, []);
    assert.equal(texts[0].day, 30);
    assert.equal(texts[0].templateKey, buildRetentionTemplateKey(30));
    assert.equal(
      texts[0].expectsReply,
      replyToken({ kind: "retention", connectionId: "con_1", day: 30 }),
    );
    assert.match(texts[0].body, /Still working at Mountain Metals\?/);
    assert.match(texts[0].body, /your coach will reach out/);
    assert.match(texts[0].body, /^SPOKES: /);
  });

  it("does not ask early", () => {
    const { texts } = selectRetentionChecks(
      [connection({ status: "started", startedAt: daysBefore(29) })],
      NOW,
    );
    assert.deepEqual(texts, []);
  });

  it("RE-ASKS an unanswered day-30 question a week later, then alerts", () => {
    // The chain used to stall here: a lifetime "already sent" check meant one
    // ignored text ended retention tracking for that placement forever, since
    // the status only advances on a reply.
    const askedOnDay30 = connection({
      status: "started",
      startedAt: daysBefore(37),
      sentMessages: [sent(buildRetentionTemplateKey(30), 7)],
    });
    const reask = selectRetentionChecks([askedOnDay30], NOW);
    assert.equal(reask.texts.length, 1, "day 37 is a re-ask");
    assert.deepEqual(reask.alerts, []);

    const askedTwice = connection({
      status: "started",
      startedAt: daysBefore(44),
      sentMessages: [
        sent(buildRetentionTemplateKey(30), 14),
        sent(buildRetentionTemplateKey(30), 7),
      ],
    });
    const stop = selectRetentionChecks([askedTwice], NOW);
    assert.deepEqual(stop.texts, [], "two unanswered asks is enough");
    assert.equal(stop.alerts.length, 1);
    assert.equal(stop.alerts[0].type, NUDGE_ALERT_TYPES.retentionUnanswered);
    assert.equal(stop.alerts[0].alertKey, "connect_retention_unanswered:con_1:30");
  });

  it("does not re-ask before the re-ask window", () => {
    assert.equal(RETENTION_REASK_DAYS, 7);
    const askedYesterday = connection({
      status: "started",
      startedAt: daysBefore(31),
      sentMessages: [sent(buildRetentionTemplateKey(30), 1)],
    });
    assert.deepEqual(selectRetentionChecks([askedYesterday], NOW).texts, []);
  });

  it("a FAILED send is not an ask: it does not count toward the two, nor retry same-day", () => {
    const failedToday = connection({
      status: "started",
      startedAt: daysBefore(31),
      sentMessages: [sent(buildRetentionTemplateKey(30), 0, "failed")],
    });
    assert.deepEqual(selectRetentionChecks([failedToday], NOW).texts, [], "backoff holds");

    const failedTwiceLongAgo = connection({
      status: "started",
      startedAt: daysBefore(40),
      sentMessages: [
        sent(buildRetentionTemplateKey(30), 9, "failed"),
        sent(buildRetentionTemplateKey(30), 8, "failed"),
      ],
    });
    const result = selectRetentionChecks([failedTwiceLongAgo], NOW);
    assert.equal(result.texts.length, 1, "two failures are zero asks");
    assert.deepEqual(result.alerts, []);
  });

  it("raises the unanswered alert only once", () => {
    const alreadyAlerted = connection({
      status: "started",
      startedAt: daysBefore(44),
      openAlertTypes: [NUDGE_ALERT_TYPES.retentionUnanswered],
      sentMessages: [
        sent(buildRetentionTemplateKey(30), 14),
        sent(buildRetentionTemplateKey(30), 7),
      ],
    });
    const result = selectRetentionChecks([alreadyAlerted], NOW);
    assert.deepEqual(result.alerts, []);
    assert.deepEqual(result.texts, []);
  });

  it("asks the question the CURRENT status is due for, not every past one", () => {
    const at60 = connection({
      status: "retained_30",
      startedAt: daysBefore(65),
      sentMessages: [sent(buildRetentionTemplateKey(30), 35)],
    });
    const { texts } = selectRetentionChecks([at60], NOW);
    assert.equal(texts.length, 1);
    assert.equal(texts[0].day, 60);
  });

  it("asks nothing once retention is complete or the connection is closed", () => {
    for (const status of ["retained_90", "closed", "withdrawn"] as const) {
      const result = selectRetentionChecks(
        [connection({ status, startedAt: daysBefore(120) })],
        NOW,
      );
      assert.deepEqual(result.texts, [], status);
      assert.deepEqual(result.alerts, [], status);
    }
  });
});

describe('"did you hear back?" on a self-directed application', () => {
  function savedJob(overrides: Partial<SavedJobSnapshot> = {}): SavedJobSnapshot {
    return {
      id: "sj_1",
      studentId: "stu_1",
      jobTitle: "Production Associate",
      status: "applied",
      appliedAt: daysBefore(HEARD_BACK_DAYS),
      alreadyAsked: false,
      askFailedRecently: false,
      ...overrides,
    };
  }

  it("asks 7 days after the applied timestamp", () => {
    assert.equal(HEARD_BACK_DAYS, 7);
    const [item] = selectHeardBackChecks([savedJob()], NOW);
    assert.equal(item.templateKey, heardBackTemplateKey("sj_1"));
    assert.equal(item.savedJobId, "sj_1");
    assert.equal(item.expectsReply, replyToken({ kind: "heard_back", savedJobId: "sj_1" }));
    // "Got an interview?" rather than "did you hear back?": Y sets the saved
    // job to `interviewing`, and the old wording asked a broader question than
    // the answer records.
    assert.match(item.body, /Got an interview for the Production Associate job\?/);
  });

  it("does not retry inside the failure backoff", () => {
    assert.deepEqual(selectHeardBackChecks([savedJob({ askFailedRecently: true })], NOW), []);
  });

  it("skips one applied yesterday, one already asked, and one that has moved on", () => {
    assert.deepEqual(selectHeardBackChecks([savedJob({ appliedAt: daysBefore(1) })], NOW), []);
    assert.deepEqual(selectHeardBackChecks([savedJob({ alreadyAsked: true })], NOW), []);
    assert.deepEqual(selectHeardBackChecks([savedJob({ status: "interviewing" })], NOW), []);
    assert.deepEqual(selectHeardBackChecks([savedJob({ appliedAt: null })], NOW), []);
  });
});

describe("the weekly jobs nudge", () => {
  it("fires from Monday 10:00 America/New_York onwards, not in one single hour", () => {
    // A single-hour window meant one missed cron slot — a deploy, a pg_net
    // timeout — silently skipped the whole class for a week.
    assert.equal(WEEKLY_NUDGE_HOUR_ET, 10);
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T14:00:00Z")), true, "Monday 10:00 EDT");
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T15:00:00Z")), true, "Monday 11:00 EDT");
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T23:30:00Z")), true, "Monday 19:30 EDT");
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T13:00:00Z")), false, "Monday 09:00 EDT");
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-08T14:00:00Z")), false, "Tuesday");
    // 2026-09-07 09:00 EST would be 14:00Z only if the offset were -5; in
    // September it is -4, so this instant is Sunday evening, not Monday.
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T03:00:00Z")), false, "Sunday 23:00 EDT");
  });

  it("skips a student with nothing new, and texts one who has", () => {
    const candidates: WeeklyCandidate[] = [
      { studentId: "stu_none", newLeadCount: 0 },
      { studentId: "stu_some", newLeadCount: 4 },
    ];
    const items = selectWeeklyJobsRecipients(candidates);
    assert.equal(items.length, 1);
    assert.equal(items[0].studentId, "stu_some");
    assert.equal(items[0].templateKey, "weekly_jobs");
    assert.equal(items[0].expectsReply, replyToken({ kind: "weekly_jobs" }));
    assert.equal(
      items[0].body,
      "SPOKES: 4 new jobs near you this week. Reply Y to see them on your Career page. Reply STOP to stop.",
    );
  });

  it("says \"1 new job\", not \"1 new jobs\"", () => {
    const [one] = selectWeeklyJobsRecipients([{ studentId: "stu_one", newLeadCount: 1 }]);
    assert.match(one.body, /^SPOKES: 1 new job near you this week\./);
  });

  it("counts leads over the last 7 days", () => {
    assert.equal(WEEKLY_NUDGE_LOOKBACK_DAYS, 7);
  });
});

describe("reply tokens round-trip", () => {
  it("parses every token it builds", () => {
    const tokens = [
      { kind: "weekly_jobs" } as const,
      { kind: "heard_back", savedJobId: "sj_1" } as const,
      { kind: "retention", connectionId: "con_1", day: 60 } as const,
      { kind: "interview_confirm", connectionId: "con_1" } as const,
    ];
    for (const token of tokens) {
      assert.deepEqual(parseReplyToken(replyToken(token)), token);
    }
  });

  it("returns null for anything it did not write", () => {
    for (const raw of ["", "retention", "retention:con_1", "retention:con_1:45", "nope:1"]) {
      assert.equal(parseReplyToken(raw), null, raw);
    }
  });
});
