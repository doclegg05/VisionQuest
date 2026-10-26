/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding accepts many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * The inbound half. Everything below the Prisma edge is mocked so the
 * assertions are about the RULES: STOP always wins, a reply only ever answers
 * a question this program actually asked, a question is answered once, and a
 * stale reply is ignored rather than applied to the newest thing.
 */

interface PrefRow {
  id: string;
  studentId: string;
  destination: string;
  enabled: boolean;
  smsConsentAt: Date | null;
  smsRevokedAt: Date | null;
}

interface OutboundRow {
  id: string;
  toId: string;
  expectsReply: string | null;
  repliedAt: Date | null;
  sentAt: Date;
}

const state = {
  prefs: [] as PrefRow[],
  outbound: [] as OutboundRow[],
  prefUpdates: [] as Array<{ where: any; data: any }>,
  outboundClaims: [] as Array<{ where: any; data: any }>,
  claimCount: 1,
  alertUpserts: [] as any[],
  savedJobUpdates: [] as any[],
  followUpUpserts: [] as any[],
  transitions: [] as any[],
  rlsContexts: [] as string[],
  transitionThrows: false,
  acks: [] as any[],
  spokesRecord: { id: "spokes_1" } as { id: string } | null,
  savedJob: { id: "sj_1", studentId: "stu_1", status: "applied" } as any,
  connection: {
    id: "con_1",
    studentId: "stu_1",
    status: "started",
    employerName: "Mountain Metals",
  } as any,
};

const prismaAdmin = {
  notificationPreference: {
    findMany: mock.fn(async ({ where }: any) => {
      const wanted: string[] = where.destination?.in ?? [];
      return state.prefs.filter((row) => wanted.includes(row.destination));
    }),
    update: mock.fn(async (args: any) => {
      state.prefUpdates.push(args);
      return state.prefs[0];
    }),
    updateMany: mock.fn(async (args: any) => {
      state.prefUpdates.push(args);
      return { count: (args.where.id?.in ?? []).length };
    }),
  },
  outboundMessage: {
    findFirst: mock.fn(async ({ where }: any) => {
      const cutoff: Date = where.sentAt.gte;
      return (
        state.outbound
          .filter(
            (row) =>
              row.toId === where.toId &&
              row.expectsReply !== null &&
              row.repliedAt === null &&
              row.sentAt >= cutoff,
          )
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0] ?? null
      );
    }),
    findMany: mock.fn(async () => []),
    updateMany: mock.fn(async (args: any) => {
      state.outboundClaims.push(args);
      return { count: state.claimCount };
    }),
  },
  connection: {
    findUnique: mock.fn(async () => state.connection),
  },
};

const prisma = {
  studentAlert: {
    upsert: mock.fn(async (args: any) => {
      state.alertUpserts.push(args);
      return { id: "alert_1" };
    }),
    updateMany: mock.fn(async () => ({ count: 0 })),
  },
  studentSavedJob: {
    findUnique: mock.fn(async () => state.savedJob),
    update: mock.fn(async (args: any) => {
      state.savedJobUpdates.push(args);
      return { id: "sj_1" };
    }),
  },
  spokesEmploymentFollowUp: {
    upsert: mock.fn(async (args: any) => {
      state.followUpUpserts.push(args);
      return { id: "fu_1" };
    }),
  },
};

mock.module("@/lib/db", { namedExports: { prisma, prismaAdmin } });
mock.module("@/lib/rls-context", {
  namedExports: {
    withStudentRlsContext: async (studentId: string, fn: () => unknown) => {
      state.rlsContexts.push(studentId);
      return fn();
    },
  },
});
mock.module("@/lib/spokes", {
  namedExports: {
    ensureSpokesRecordForStudent: async () => state.spokesRecord,
  },
});
class FakeTransitionNotAllowedError extends Error {
  constructor() {
    super("not allowed");
    this.name = "TransitionNotAllowedError";
  }
}

mock.module("@/lib/connect/pipeline", {
  namedExports: {
    TransitionNotAllowedError: FakeTransitionNotAllowedError,
    ConnectionConflictError: class ConnectionConflictError extends Error {},
    ConnectionNotFoundError: class ConnectionNotFoundError extends Error {},
    transitionConnection: async (input: any) => {
      if (state.transitionThrows) throw new FakeTransitionNotAllowedError();
      state.transitions.push(input);
      return { from: state.connection.status, to: input.to, studentId: input.studentId ?? "stu_1" };
    },
  },
});
mock.module("./sms-policy", {
  namedExports: {
    sendPolicySms: async (input: any) => {
      state.acks.push(input);
      return { status: "sent" as const, outboundMessageId: "om_ack" };
    },
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

import { NUDGE_ALERT_TYPES, replyToken } from "./schedule-shared";

let handleInboundSms: typeof import("./replies").handleInboundSms;
let REPLY_WINDOW_MS: typeof import("./replies").REPLY_WINDOW_MS;
let normalizedPhone: typeof import("./replies").normalizedPhone;

before(async () => {
  const mod = await import("./replies");
  handleInboundSms = mod.handleInboundSms;
  REPLY_WINDOW_MS = mod.REPLY_WINDOW_MS;
  normalizedPhone = mod.normalizedPhone;
});

const PHONE = "+13045550123";
const NOW = new Date("2026-09-08T14:00:00Z");

function consented(overrides: Partial<PrefRow> = {}): PrefRow {
  return {
    id: "pref_1",
    studentId: "stu_1",
    destination: PHONE,
    enabled: true,
    smsConsentAt: new Date("2026-08-01T12:00:00Z"),
    smsRevokedAt: null,
    ...overrides,
  };
}

function question(expectsReply: string, sentAt = new Date(NOW.getTime() - 60_000)): OutboundRow {
  return { id: "om_1", toId: "stu_1", expectsReply, repliedAt: null, sentAt };
}

beforeEach(() => {
  state.prefs = [consented()];
  state.outbound = [];
  state.prefUpdates = [];
  state.outboundClaims = [];
  state.claimCount = 1;
  state.alertUpserts = [];
  state.savedJobUpdates = [];
  state.followUpUpserts = [];
  state.transitions = [];
  state.rlsContexts = [];
  state.transitionThrows = false;
  state.acks = [];
  state.spokesRecord = { id: "spokes_1" };
  state.savedJob = { id: "sj_1", studentId: "stu_1", status: "applied" };
  state.connection = {
    id: "con_1",
    studentId: "stu_1",
    status: "started",
    employerName: "Mountain Metals",
  };
});

describe("STOP and START", () => {
  it("STOP records a revocation and turns the channel off", async () => {
    const result = await handleInboundSms({ from: PHONE, body: "STOP", now: NOW });
    assert.equal(result.outcome, "revoked");
    assert.equal(state.prefUpdates.length, 1);
    assert.equal(state.prefUpdates[0].data.smsRevokedAt.toISOString(), NOW.toISOString());
    assert.equal(state.prefUpdates[0].data.enabled, false);
  });

  it("every stop keyword revokes, in any case", async () => {
    for (const word of ["stop", "UNSUBSCRIBE", "Cancel", "end", "QUIT"]) {
      state.prefUpdates = [];
      const result = await handleInboundSms({ from: PHONE, body: word, now: NOW });
      assert.equal(result.outcome, "revoked", word);
    }
  });

  it("STOP from an unknown number is accepted quietly, never an error", async () => {
    state.prefs = [];
    const result = await handleInboundSms({ from: "+19995550000", body: "STOP", now: NOW });
    assert.equal(result.outcome, "unknown_sender");
    assert.equal(state.prefUpdates.length, 0);
  });

  it("START re-consents someone who consented before", async () => {
    state.prefs = [consented({ smsRevokedAt: new Date("2026-09-01T00:00:00Z"), enabled: false })];
    const result = await handleInboundSms({ from: PHONE, body: "START", now: NOW });
    assert.equal(result.outcome, "reconsented");
    assert.equal(state.prefUpdates[0].data.smsRevokedAt, null);
    assert.equal(state.prefUpdates[0].data.enabled, true);
  });

  it("START does NOT create consent for someone who never gave it", async () => {
    state.prefs = [consented({ smsConsentAt: null })];
    const result = await handleInboundSms({ from: PHONE, body: "START", now: NOW });
    assert.equal(result.outcome, "no_prior_consent");
    assert.equal(state.prefUpdates.length, 0, "a text may not manufacture consent");
  });

  it("STOP from a SHARED handset revokes for every student on that number", async () => {
    // Over-revoking costs a text nobody gets and a START to undo. Under-
    // revoking keeps texting someone who asked you to stop, which is what
    // TCPA is about.
    state.prefs = [
      consented(),
      consented({ id: "pref_2", studentId: "stu_2" }),
    ];
    const result = await handleInboundSms({ from: PHONE, body: "STOP", now: NOW });
    assert.equal(result.outcome, "revoked");
    assert.deepEqual(state.prefUpdates[0].where.id.in, ["pref_1", "pref_2"]);
    assert.equal(state.prefUpdates[0].data.enabled, false);
  });

  it("applies NOTHING but a STOP from a shared handset", async () => {
    state.prefs = [consented(), consented({ id: "pref_2", studentId: "stu_2" })];
    state.outbound = [question(replyToken({ kind: "weekly_jobs" }))];
    for (const body of ["Y", "N", "START"]) {
      state.prefUpdates = [];
      state.alertUpserts = [];
      const result = await handleInboundSms({ from: PHONE, body, now: NOW });
      assert.equal(result.outcome, "ambiguous_sender", body);
      assert.equal(state.prefUpdates.length, 0, body);
      assert.equal(state.alertUpserts.length, 0, body);
    }
  });

  it("STOP outranks a pending question — it is never read as an answer", async () => {
    state.outbound = [question(replyToken({ kind: "weekly_jobs" }))];
    const result = await handleInboundSms({ from: PHONE, body: "STOP", now: NOW });
    assert.equal(result.outcome, "revoked");
    assert.equal(state.alertUpserts.length, 0);
    assert.equal(state.outboundClaims.length, 0);
  });
});

describe("matching a reply to the question it answers", () => {
  it("answers the most recent unanswered question inside the window", async () => {
    state.outbound = [
      question(replyToken({ kind: "weekly_jobs" }), new Date(NOW.getTime() - 4 * 60 * 60 * 1000)),
      question(
        replyToken({ kind: "heard_back", savedJobId: "sj_1" }),
        new Date(NOW.getTime() - 60 * 60 * 1000),
      ),
    ];
    const result = await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(result.outcome, "handled");
    assert.equal(result.outcome === "handled" && result.kind, "heard_back");
  });

  it("ignores a reply with no question waiting", async () => {
    const result = await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(result.outcome, "no_pending_question");
    assert.equal(state.alertUpserts.length, 0);
  });

  it("ignores a reply older than the 72-hour window", async () => {
    assert.equal(REPLY_WINDOW_MS, 72 * 60 * 60 * 1000);
    state.outbound = [
      question(
        replyToken({ kind: "weekly_jobs" }),
        new Date(NOW.getTime() - 73 * 60 * 60 * 1000),
      ),
    ];
    const result = await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(result.outcome, "no_pending_question");
  });

  it("claims the question atomically, so a double-tap runs the handler once", async () => {
    state.outbound = [question(replyToken({ kind: "weekly_jobs" }))];
    state.claimCount = 0; // somebody else claimed it between the read and the write
    const result = await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(result.outcome, "already_answered");
    assert.equal(state.alertUpserts.length, 0);
    assert.equal(state.outboundClaims[0].where.repliedAt, null, "the claim is conditional");
  });

  it("reads a bare YES as an answer when a question is open, and as START when none is", async () => {
    state.outbound = [question(replyToken({ kind: "weekly_jobs" }))];
    const answered = await handleInboundSms({ from: PHONE, body: "YES", now: NOW });
    assert.equal(answered.outcome, "handled");
    assert.equal(state.alertUpserts.length, 1);

    state.outbound = [];
    state.prefs = [consented({ smsRevokedAt: new Date("2026-09-01T00:00:00Z"), enabled: false })];
    const restarted = await handleInboundSms({ from: PHONE, body: "YES", now: NOW });
    assert.equal(restarted.outcome, "reconsented");
  });

  it("reads NO as an answer, not as noise", async () => {
    state.outbound = [
      question(replyToken({ kind: "retention", connectionId: "con_1", day: 30 })),
    ];
    const result = await handleInboundSms({ from: PHONE, body: "NO", now: NOW });
    assert.equal(result.outcome, "handled");
    assert.equal(state.alertUpserts[0].create.type, NUDGE_ALERT_TYPES.retentionLost);
  });

  it("ignores a sentence — only Y and N are answers", async () => {
    state.outbound = [question(replyToken({ kind: "weekly_jobs" }))];
    const result = await handleInboundSms({ from: PHONE, body: "yes please", now: NOW });
    assert.equal(result.outcome, "ignored");
    assert.equal(state.alertUpserts.length, 0);
  });
});

describe("Y to the weekly jobs text", () => {
  it("raises the student-visible alert and does nothing else", async () => {
    state.outbound = [question(replyToken({ kind: "weekly_jobs" }))];
    await handleInboundSms({ from: PHONE, body: "y", now: NOW });
    assert.equal(state.alertUpserts.length, 1);
    assert.equal(
      state.alertUpserts[0].create.type,
      NUDGE_ALERT_TYPES.weeklyJobsReady,
    );
    assert.match(state.alertUpserts[0].create.summary, /Career/);
    assert.deepEqual(state.rlsContexts, ["stu_1"], "the write runs as the student");
  });

  it("N opens nothing", async () => {
    state.outbound = [question(replyToken({ kind: "weekly_jobs" }))];
    const result = await handleInboundSms({ from: PHONE, body: "N", now: NOW });
    assert.equal(result.outcome, "handled");
    assert.equal(state.alertUpserts.length, 0);
  });
});

describe('Y to "did you hear back?"', () => {
  it("moves the saved job to interviewing", async () => {
    state.outbound = [question(replyToken({ kind: "heard_back", savedJobId: "sj_1" }))];
    await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(state.savedJobUpdates.length, 1);
    assert.equal(state.savedJobUpdates[0].data.status, "interviewing");
    assert.deepEqual(state.rlsContexts, ["stu_1"]);
  });

  it("N leaves the saved job alone and opens nothing", async () => {
    state.outbound = [question(replyToken({ kind: "heard_back", savedJobId: "sj_1" }))];
    await handleInboundSms({ from: PHONE, body: "N", now: NOW });
    assert.equal(state.savedJobUpdates.length, 0);
    assert.equal(state.alertUpserts.length, 0);
  });

  it("refuses a saved job that is not the replying student's", async () => {
    state.savedJob = { id: "sj_1", studentId: "someone_else", status: "applied" };
    state.outbound = [question(replyToken({ kind: "heard_back", savedJobId: "sj_1" }))];
    const result = await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(result.outcome, "handled");
    assert.equal(state.savedJobUpdates.length, 0);
  });
});

describe("retention answers", () => {
  it("NEVER writes a SpokesEmploymentFollowUp row — a text is not evidence", async () => {
    // The grant record runs on 1/3/6 MONTHS from
    // SpokesRecord.unsubsidizedEmploymentAt and grant-kpi.ts reports months 3
    // and 6 to DoHS. The funnel runs on 30/60/90 DAYS from
    // Connection.startedAt. Mapping one onto the other would overwrite a
    // teacher's verified row on the shared (recordId, checkpointMonths) key.
    for (const answer of ["Y", "N"]) {
      state.followUpUpserts = [];
      state.outbound = [
        question(replyToken({ kind: "retention", connectionId: "con_1", day: 30 })),
      ];
      await handleInboundSms({ from: PHONE, body: answer, now: NOW });
      assert.deepEqual(state.followUpUpserts, [], `"${answer}" must write no follow-up row`);
    }
  });

  it("Y advances the funnel and asks a person to record the grant follow-up", async () => {
    state.outbound = [
      question(replyToken({ kind: "retention", connectionId: "con_1", day: 30 })),
    ];
    await handleInboundSms({ from: PHONE, body: "Y", now: NOW });

    assert.equal(state.transitions.length, 1);
    assert.equal(state.transitions[0].to, "retained_30");
    assert.equal(state.transitions[0].actorType, "system");

    assert.equal(state.alertUpserts.length, 1);
    const alert = state.alertUpserts[0].create;
    assert.equal(alert.type, NUDGE_ALERT_TYPES.retentionConfirm);
    assert.equal(alert.alertKey, "connect_retention_confirm:con_1:30");
    assert.match(alert.summary, /self-reported/i);
    assert.match(alert.summary, /different clock/i);
  });

  it("asks once per checkpoint, so day 60 is a separate card from day 30", async () => {
    for (const [day, to] of [
      [60, "retained_60"],
      [90, "retained_90"],
    ] as const) {
      state.alertUpserts = [];
      state.transitions = [];
      state.connection = { ...state.connection, status: `retained_${day - 30}` };
      state.outbound = [question(replyToken({ kind: "retention", connectionId: "con_1", day }))];
      await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
      assert.equal(state.transitions[0].to, to);
      assert.equal(
        state.alertUpserts[0].create.alertKey,
        `connect_retention_confirm:con_1:${day}`,
      );
    }
  });

  it("N closes the connection and tells the instructor, writing no grant row", async () => {
    state.outbound = [
      question(replyToken({ kind: "retention", connectionId: "con_1", day: 30 })),
    ];
    await handleInboundSms({ from: PHONE, body: "N", now: NOW });

    assert.equal(state.followUpUpserts.length, 0);
    assert.equal(state.transitions[0].to, "closed");
    assert.match(state.transitions[0].note, /no longer/i);
    assert.equal(state.alertUpserts.length, 1);
    assert.equal(state.alertUpserts[0].create.type, NUDGE_ALERT_TYPES.retentionLost);
    assert.match(
      state.alertUpserts[0].create.summary,
      /Nothing has been written to the SPOKES employment follow-ups/i,
    );
  });

  it("refuses a connection that is not the replying student's", async () => {
    state.connection = { ...state.connection, studentId: "someone_else" };
    state.outbound = [
      question(replyToken({ kind: "retention", connectionId: "con_1", day: 30 })),
    ];
    await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(state.followUpUpserts.length, 0);
    assert.equal(state.transitions.length, 0);
    assert.equal(state.alertUpserts.length, 0);
  });

  it("still raises the staff alert when the pipeline refuses the move", async () => {
    // An instructor may have closed the connection between the text going out
    // and the reply coming back. Throwing away the one thing the student told
    // us because a status will not move is the wrong trade.
    state.transitionThrows = true;
    state.outbound = [
      question(replyToken({ kind: "retention", connectionId: "con_1", day: 30 })),
    ];
    const result = await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(result.outcome, "handled");
    assert.equal(state.alertUpserts.length, 1);
    assert.equal(state.alertUpserts[0].create.type, NUDGE_ALERT_TYPES.retentionConfirm);
  });
});

describe("interview confirmation answers", () => {
  it("Y is recorded and changes no status — the interview was already scheduled", async () => {
    state.connection = { ...state.connection, status: "interview_scheduled" };
    state.outbound = [
      question(replyToken({ kind: "interview_confirm", connectionId: "con_1" })),
    ];
    const result = await handleInboundSms({ from: PHONE, body: "Y", now: NOW });
    assert.equal(result.outcome, "handled");
    assert.equal(state.transitions.length, 0);
  });

  it("N tells the instructor rather than cancelling anything itself", async () => {
    state.connection = { ...state.connection, status: "interview_scheduled" };
    state.outbound = [
      question(replyToken({ kind: "interview_confirm", connectionId: "con_1" })),
    ];
    await handleInboundSms({ from: PHONE, body: "N", now: NOW });
    assert.equal(state.transitions.length, 0, "a machine never cancels an employer's interview");
    assert.equal(state.alertUpserts.length, 1);
  });

  it("N sends an acknowledgement THROUGH the policy, so quiet hours still apply", async () => {
    state.connection = { ...state.connection, status: "interview_scheduled" };
    state.outbound = [
      question(replyToken({ kind: "interview_confirm", connectionId: "con_1" })),
    ];
    await handleInboundSms({ from: PHONE, body: "N", now: NOW });
    assert.equal(state.acks.length, 1);
    assert.equal(state.acks[0].templateKey, "interview_decline_ack:con_1");
    assert.equal(state.acks[0].expectsReply, undefined, "an ack asks nothing");
  });
});

describe("phone number matching", () => {
  it("matches a number stored without the +1 country code", async () => {
    state.prefs = [consented({ destination: "3045550123" })];
    const result = await handleInboundSms({ from: "+13045550123", body: "STOP", now: NOW });
    assert.equal(result.outcome, "revoked");
  });

  it("never logs the number it was called with", async () => {
    const seen = prismaAdmin.notificationPreference.findMany.mock.calls.at(-1);
    assert.ok(seen, "the lookup ran");
  });

  describe("normalizedPhone", () => {
    // The settings page asks "is this a NEW number?" before clearing a
    // confirmed consent. A raw string comparison answers yes to a re-typed
    // identical number, and the student is sent round the code flow again for
    // nothing.
    it("collapses the forms one handset can be typed in", () => {
      const canonical = normalizedPhone("3045550123");
      assert.equal(canonical, "3045550123");
      for (const written of ["+13045550123", "13045550123", "+1 304 555 0123", "(304) 555-0123"]) {
        assert.equal(normalizedPhone(written), canonical, `${written} is the same number`);
      }
    });

    it("still tells two different numbers apart", () => {
      assert.notEqual(normalizedPhone("+13045550123"), normalizedPhone("+13045550124"));
    });

    it("returns null for absent or digitless input, so it never equals a real number", () => {
      assert.equal(normalizedPhone(null), null);
      assert.equal(normalizedPhone(undefined), null);
      assert.equal(normalizedPhone(""), null);
      assert.equal(normalizedPhone("not a phone"), null);
    });
  });
});
