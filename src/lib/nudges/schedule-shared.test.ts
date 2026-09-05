import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPLOYER_NO_RESPONSE_DAYS,
  EMPLOYER_NO_VIEW_DAYS,
  HEARD_BACK_DAYS,
  INTERVIEW_LOOKAHEAD_HOURS,
  NUDGE_ALERT_TYPES,
  RETENTION_DAYS,
  WEEKLY_NUDGE_HOUR_ET,
  WEEKLY_NUDGE_LOOKBACK_DAYS,
  buildRetentionTemplateKey,
  isWeeklyNudgeSlot,
  parseReplyToken,
  replyToken,
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
    sentTemplateKeys: [],
    openAlertTypes: [],
    ...overrides,
  };
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
  it("texts once, for an interview inside the next 24 hours", () => {
    assert.equal(INTERVIEW_LOOKAHEAD_HOURS, 24);
    const soon = connection({
      status: "interview_scheduled",
      interviewStartsAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
    });
    const [item] = selectInterviewConfirmations([soon], NOW);
    assert.equal(item.templateKey, "interview_confirm");
    assert.equal(item.connectionId, "con_1");
    assert.equal(item.expectsReply, replyToken({ kind: "interview_confirm", connectionId: "con_1" }));
  });

  it("skips one already texted, one further out, and one already past", () => {
    const base = {
      status: "interview_scheduled" as const,
      interviewStartsAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
    };
    assert.deepEqual(
      selectInterviewConfirmations(
        [connection({ ...base, sentTemplateKeys: ["interview_confirm"] })],
        NOW,
      ),
      [],
    );
    assert.deepEqual(
      selectInterviewConfirmations(
        [connection({ ...base, interviewStartsAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000) })],
        NOW,
      ),
      [],
    );
    assert.deepEqual(
      selectInterviewConfirmations(
        [connection({ ...base, interviewStartsAt: daysBefore(1) })],
        NOW,
      ),
      [],
    );
  });
});

describe("retention check-ins at 30, 60 and 90 days", () => {
  it("uses the days the plan names, in order", () => {
    assert.deepEqual([...RETENTION_DAYS], [30, 60, 90]);
  });

  it("asks the 30-day question 30 days after the connection STARTED", () => {
    const started = connection({ status: "started", startedAt: daysBefore(30) });
    const [item] = selectRetentionChecks([started], NOW);
    assert.equal(item.day, 30);
    assert.equal(item.templateKey, buildRetentionTemplateKey(30));
    assert.equal(item.expectsReply, replyToken({ kind: "retention", connectionId: "con_1", day: 30 }));
    assert.match(item.body, /Still working at Mountain Metals\?/);
    assert.match(item.body, /^SPOKES: /);
  });

  it("does not ask early, and asks each day exactly once", () => {
    assert.deepEqual(
      selectRetentionChecks([connection({ status: "started", startedAt: daysBefore(29) })], NOW),
      [],
    );
    assert.deepEqual(
      selectRetentionChecks(
        [
          connection({
            status: "started",
            startedAt: daysBefore(35),
            sentTemplateKeys: [buildRetentionTemplateKey(30)],
          }),
        ],
        NOW,
      ),
      [],
      "the 30-day question is asked once even if the sweep runs for days",
    );
  });

  it("asks the question the CURRENT status is due for, not every past one", () => {
    // 65 days in and already recorded at 30: the next question is 60, not 90.
    const at60 = connection({
      status: "retained_30",
      startedAt: daysBefore(65),
      sentTemplateKeys: [buildRetentionTemplateKey(30)],
    });
    const items = selectRetentionChecks([at60], NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0].day, 60);
  });

  it("asks nothing once retention is complete or the connection is closed", () => {
    for (const status of ["retained_90", "closed", "withdrawn"] as const) {
      assert.deepEqual(
        selectRetentionChecks([connection({ status, startedAt: daysBefore(120) })], NOW),
        [],
        status,
      );
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
      ...overrides,
    };
  }

  it("asks 7 days after the applied timestamp", () => {
    assert.equal(HEARD_BACK_DAYS, 7);
    const [item] = selectHeardBackChecks([savedJob()], NOW);
    assert.equal(item.templateKey, "heard_back");
    assert.equal(item.savedJobId, "sj_1");
    assert.equal(item.expectsReply, replyToken({ kind: "heard_back", savedJobId: "sj_1" }));
    assert.match(item.body, /Did you hear back about the Production Associate job\?/);
  });

  it("skips one applied yesterday, one already asked, and one that has moved on", () => {
    assert.deepEqual(selectHeardBackChecks([savedJob({ appliedAt: daysBefore(1) })], NOW), []);
    assert.deepEqual(selectHeardBackChecks([savedJob({ alreadyAsked: true })], NOW), []);
    assert.deepEqual(selectHeardBackChecks([savedJob({ status: "interviewing" })], NOW), []);
    assert.deepEqual(selectHeardBackChecks([savedJob({ appliedAt: null })], NOW), []);
  });
});

describe("the weekly jobs nudge", () => {
  it("fires only in the Monday 10:00 America/New_York hour", () => {
    assert.equal(WEEKLY_NUDGE_HOUR_ET, 10);
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T14:00:00Z")), true, "Monday 10:00 EDT");
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T14:59:00Z")), true, "still the 10am hour");
    assert.equal(isWeeklyNudgeSlot(new Date("2026-09-07T15:00:00Z")), false, "11:00 EDT");
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
      "SPOKES: 4 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
    );
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
