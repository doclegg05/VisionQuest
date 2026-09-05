import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONNECTION_STATUSES } from "./pipeline-shared";
import {
  EXIT_STATUSES,
  FUNNEL_STAGE_ORDER,
  MIN_MEDIAN_SAMPLE_SIZE,
  computeFunnel,
  furthestFunnelStageIndex,
  type FunnelConnectionRow,
  type FunnelEventRow,
  type SelfDirectedApplicationRow,
} from "./funnel-shared";

function connection(overrides: Partial<FunnelConnectionRow> = {}): FunnelConnectionRow {
  return {
    id: "conn-1",
    studentId: "student-1",
    employerId: "employer-1",
    employerName: "Mountain Metals",
    classId: "class-1",
    className: "SPOKES Fall 2026",
    status: "proposed",
    createdAt: "2026-06-01T00:00:00.000Z",
    sentAt: null,
    hiredAt: null,
    packet: null,
    ...overrides,
  };
}

function event(overrides: Partial<FunnelEventRow>): FunnelEventRow {
  return {
    connectionId: "conn-1",
    toStatus: "proposed",
    at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function stageCount(result: ReturnType<typeof computeFunnel>, status: string): number {
  return result.stages.find((s) => s.status === status)?.count ?? -1;
}

describe("computeFunnel — furthest-stage counting", () => {
  it("counts a connection at the furthest funnel stage its events reached", () => {
    // `sentAt` is set because the send SUCCEEDED. A connection carrying a
    // "sent" event with no `sentAt` is specifically a rolled-back send, and is
    // covered by its own case below — the fixture default of null was
    // describing a state the app cannot produce.
    const connections = [
      connection({ id: "c1", status: "interested", sentAt: "2026-06-02T00:00:00.000Z" }),
    ];
    const events = [
      event({ connectionId: "c1", toStatus: "proposed" }),
      event({ connectionId: "c1", toStatus: "student_approved" }),
      event({ connectionId: "c1", toStatus: "sent" }),
      event({ connectionId: "c1", toStatus: "interested" }),
    ];
    const result = computeFunnel(connections, events);
    assert.equal(stageCount(result, "interested"), 1);
    assert.equal(stageCount(result, "sent"), 0);
    assert.equal(stageCount(result, "proposed"), 0);
  });

  it("a CLOSED connection that reached 'interested' still counts at interested, not at closed", () => {
    const connections = [
      connection({ id: "c1", status: "closed", sentAt: "2026-06-02T00:00:00.000Z" }),
    ];
    const events = [
      event({ connectionId: "c1", toStatus: "proposed" }),
      event({ connectionId: "c1", toStatus: "student_approved" }),
      event({ connectionId: "c1", toStatus: "sent" }),
      event({ connectionId: "c1", toStatus: "interested" }),
      event({ connectionId: "c1", toStatus: "closed" }),
    ];
    const result = computeFunnel(connections, events);
    assert.equal(stageCount(result, "interested"), 1);
    // "closed" is not in FUNNEL_STAGE_ORDER at all — it must never appear as
    // a stage count; it belongs in `exits` instead.
    assert.ok(!result.stages.some((s) => (s.status as string) === "closed"));
    assert.equal(result.exits.closed, 1);
  });

  it("does NOT count a rolled-back send as sent", () => {
    // `sendConnection` claims the transition to "sent" BEFORE it emails, so
    // the token that exists in the world is always one the database knows
    // about. When the email then fails, `rollBackFailedSend` puts the row back
    // and nulls `sentAt` — but the "sent" event stays, because the log is
    // append-only and the claim genuinely happened.
    //
    // Counting that as "sent" is the one number on this report nobody would
    // question and nobody could reproduce: a broken mail server would show a
    // healthy send rate beside a mysterious zero response rate.
    const connections = [
      connection({ id: "c1", status: "student_approved", sentAt: null }),
    ];
    const events = [
      event({ connectionId: "c1", toStatus: "proposed" }),
      event({ connectionId: "c1", toStatus: "student_approved" }),
      event({ connectionId: "c1", toStatus: "sent" }),
      // The compensating row rollBackFailedSend writes.
      event({ connectionId: "c1", toStatus: "student_approved" }),
    ];

    const result = computeFunnel(connections, events);
    assert.equal(stageCount(result, "sent"), 0, "a packet that never left counted as sent");
    assert.equal(stageCount(result, "student_approved"), 1);
  });

  it("DOES count a re-send that succeeded after an earlier rollback", () => {
    // The discriminator is `sentAt`, not the absence of a "sent" event — so a
    // second attempt that worked writes a new `sentAt` and the connection
    // counts from then on, with the failed first attempt still in the log.
    const connections = [
      connection({ id: "c1", status: "sent", sentAt: "2026-06-02T00:00:00.000Z" }),
    ];
    const events = [
      event({ connectionId: "c1", toStatus: "proposed" }),
      event({ connectionId: "c1", toStatus: "student_approved" }),
      event({ connectionId: "c1", toStatus: "sent" }),
      event({ connectionId: "c1", toStatus: "student_approved" }),
      event({ connectionId: "c1", toStatus: "sent" }),
    ];

    const result = computeFunnel(connections, events);
    assert.equal(stageCount(result, "sent"), 1);
    assert.equal(stageCount(result, "student_approved"), 0);
  });

  it("defaults to 'proposed' when a connection somehow has no funnel-stage event", () => {
    const connections = [connection({ id: "c1" })];
    const result = computeFunnel(connections, []);
    assert.equal(stageCount(result, "proposed"), 1);
  });

  it("every connection appears in exactly one stage bucket", () => {
    const connections = [
      connection({ id: "c1" }),
      connection({ id: "c2", status: "hired", hiredAt: "2026-06-10" }),
      connection({ id: "c3", status: "not_now" }),
    ];
    const events = [
      event({ connectionId: "c1", toStatus: "proposed" }),
      event({ connectionId: "c2", toStatus: "proposed" }),
      event({ connectionId: "c2", toStatus: "sent" }),
      event({ connectionId: "c2", toStatus: "interested" }),
      event({ connectionId: "c2", toStatus: "hired" }),
      event({ connectionId: "c3", toStatus: "proposed" }),
      event({ connectionId: "c3", toStatus: "sent" }),
      event({ connectionId: "c3", toStatus: "not_now" }),
    ];
    const result = computeFunnel(connections, events);
    const total = result.stages.reduce((sum, s) => sum + s.count, 0);
    assert.equal(total, 3);
  });
});

describe("furthestFunnelStageIndex", () => {
  it("is exported for dohs-export-shared's retention fallback and matches funnelStageIndex order", () => {
    assert.equal(furthestFunnelStageIndex([]), 0);
    assert.equal(furthestFunnelStageIndex(["proposed", "sent"]), FUNNEL_STAGE_ORDER.indexOf("sent"));
    assert.equal(
      furthestFunnelStageIndex(["sent", "retained_60", "not_now"]),
      FUNNEL_STAGE_ORDER.indexOf("retained_60"),
    );
  });
});

describe("computeFunnel — exits", () => {
  it("tallies not_now, withdrawn, and closed independently", () => {
    const connections = [
      connection({ id: "c1", status: "not_now" }),
      connection({ id: "c2", status: "withdrawn" }),
      connection({ id: "c3", status: "closed" }),
      connection({ id: "c4", status: "closed" }),
      connection({ id: "c5", status: "sent" }),
    ];
    const result = computeFunnel(connections, []);
    assert.deepEqual(result.exits, { not_now: 1, withdrawn: 1, closed: 2 });
  });

  it("a non-exited connection contributes zero to every exit bucket", () => {
    const connections = [connection({ id: "c1", status: "sent" })];
    const result = computeFunnel(connections, []);
    assert.deepEqual(result.exits, { not_now: 0, withdrawn: 0, closed: 0 });
  });
});

describe("drift guard: FUNNEL_STAGE_ORDER + EXIT_STATUSES == CONNECTION_STATUSES", () => {
  it("every real ConnectionStatus is either a funnel stage or an exit, with none left over", () => {
    const combined = new Set<string>([...FUNNEL_STAGE_ORDER, ...EXIT_STATUSES]);
    const real = new Set<string>(CONNECTION_STATUSES);
    assert.deepEqual(combined, real);
  });

  it("no status is double-counted as both a stage and an exit", () => {
    const overlap = FUNNEL_STAGE_ORDER.filter((stage) => (EXIT_STATUSES as readonly string[]).includes(stage));
    assert.deepEqual(overlap, []);
  });
});

describe("computeFunnel — period boundaries", () => {
  it("excludes a connection created before `from`", () => {
    const connections = [connection({ id: "c1", createdAt: "2026-05-31T23:59:59.000Z" })];
    const result = computeFunnel(connections, [], { from: "2026-06-01T00:00:00.000Z" });
    assert.equal(result.stages.reduce((s, r) => s + r.count, 0), 0);
  });

  it("includes a connection created exactly at `from` (inclusive lower bound)", () => {
    const connections = [connection({ id: "c1", createdAt: "2026-06-01T00:00:00.000Z" })];
    const result = computeFunnel(connections, [], { from: "2026-06-01T00:00:00.000Z" });
    assert.equal(result.stages.reduce((s, r) => s + r.count, 0), 1);
  });

  it("excludes a connection created at or after the EXCLUSIVE `to` bound", () => {
    const connections = [connection({ id: "c1", createdAt: "2026-07-01T00:00:00.000Z" })];
    const result = computeFunnel(connections, [], { to: "2026-07-01T00:00:00.000Z" });
    assert.equal(
      result.stages.reduce((s, r) => s + r.count, 0),
      0,
      "`to` is exclusive — an instant exactly at it must not be included",
    );
  });

  it("includes a connection created one millisecond before the exclusive `to` bound", () => {
    const connections = [connection({ id: "c1", createdAt: "2026-06-30T23:59:59.999Z" })];
    const result = computeFunnel(connections, [], { to: "2026-07-01T00:00:00.000Z" });
    assert.equal(result.stages.reduce((s, r) => s + r.count, 0), 1);
  });

  it("date-only boundaries: a caller resolving 'YYYY-MM-DD' to ET instants (reportDateRangeBoundsUtc) gets the whole `to` day", () => {
    // Mirrors what funnel.ts actually does: resolve the date-only "to" param
    // via reportDateRangeBoundsUtc BEFORE calling computeFunnel, so this test
    // exercises computeFunnel's half of that contract — passing the already
    // -resolved exclusive bound and checking a late-evening ET connection
    // still lands inside it. 2026-07-01T01:30:00Z = 2026-06-30 9:30pm EDT.
    const lateEveningOnTheToDay = "2026-07-01T01:30:00.000Z";
    const exclusiveToBound = "2026-07-01T04:00:00.000Z"; // ET midnight July 1
    const connections = [connection({ id: "c1", createdAt: lateEveningOnTheToDay })];
    const result = computeFunnel(connections, [], { to: exclusiveToBound });
    assert.equal(result.stages.reduce((s, r) => s + r.count, 0), 1);
  });

  it("also excludes that connection's events, so it cannot pollute another period's stage counts", () => {
    const connections = [
      connection({ id: "in", createdAt: "2026-06-15T00:00:00.000Z" }),
      connection({ id: "out", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const events = [
      event({ connectionId: "in", toStatus: "proposed" }),
      event({ connectionId: "out", toStatus: "hired" }),
    ];
    const result = computeFunnel(connections, events, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(stageCount(result, "hired"), 0);
    assert.equal(stageCount(result, "proposed"), 1);
  });
});

/** Five is MIN_MEDIAN_SAMPLE_SIZE — every median-producing test below needs
 * at least this many qualifying connections or it will read null. */
function connectionsWithResponseDays(days: number[]): { connections: FunnelConnectionRow[]; events: FunnelEventRow[] } {
  const connections: FunnelConnectionRow[] = [];
  const events: FunnelEventRow[] = [];
  days.forEach((day, index) => {
    const id = `c${index}`;
    connections.push(connection({ id, sentAt: "2026-06-01T00:00:00.000Z" }));
    events.push(event({ connectionId: id, toStatus: "proposed", at: "2026-06-01T00:00:00.000Z" }));
    const respondedAt = new Date(new Date("2026-06-01T00:00:00.000Z").getTime() + day * 86400000);
    events.push(event({ connectionId: id, toStatus: "interested", at: respondedAt.toISOString() }));
  });
  return { connections, events };
}

describe("computeFunnel — medians", () => {
  it("send-to-response median over an ODD count of values (>= MIN_MEDIAN_SAMPLE_SIZE)", () => {
    assert.equal(MIN_MEDIAN_SAMPLE_SIZE, 5);
    // days: 1, 3, 5, 7, 9 -> nearest-rank p50 of 5 values is the 3rd = 5
    const { connections, events } = connectionsWithResponseDays([1, 3, 5, 7, 9]);
    const result = computeFunnel(connections, events);
    assert.equal(result.medians.sendToResponseDays, 5);
  });

  it("send-to-response median over an EVEN count of values (nearest-rank, lower-middle)", () => {
    // days: 2, 4, 6, 8, 10, 12 -> nearest-rank p50 of 6 values is the 3rd = 6
    const { connections, events } = connectionsWithResponseDays([2, 4, 6, 8, 10, 12]);
    const result = computeFunnel(connections, events);
    assert.equal(result.medians.sendToResponseDays, 6);
  });

  it("send-to-hire median only counts connections with both sentAt and hiredAt", () => {
    const connections = [
      connection({ id: "c1", sentAt: "2026-06-01", hiredAt: "2026-06-11" }),
      connection({ id: "c2", sentAt: "2026-06-01", hiredAt: "2026-06-13" }),
      connection({ id: "c3", sentAt: "2026-06-01", hiredAt: "2026-06-15" }),
      connection({ id: "c4", sentAt: "2026-06-01", hiredAt: "2026-06-17" }),
      connection({ id: "c5", sentAt: "2026-06-01", hiredAt: "2026-06-19" }),
      connection({ id: "c6", sentAt: "2026-06-01", hiredAt: null }),
      connection({ id: "c7", sentAt: null, hiredAt: "2026-06-20" }),
    ];
    const result = computeFunnel(connections, []);
    // days: 10, 12, 14, 16, 18 -> median (3rd of 5) = 14
    assert.equal(result.medians.sendToHireDays, 14);
  });

  it("suppresses the median (returns null, not a number) below MIN_MEDIAN_SAMPLE_SIZE — small-class identifiability", () => {
    const { connections, events } = connectionsWithResponseDays([1, 3, 5, 7]); // 4 < 5
    const result = computeFunnel(connections, events);
    assert.equal(result.medians.sendToResponseDays, null);
  });

  it("send-to-response is derived from the EARLIEST response event, not the last one", () => {
    // sent day 0, marked interested day 2, hired day 20 -> response = 2 days,
    // NOT 20. Five connections so the sample clears MIN_MEDIAN_SAMPLE_SIZE;
    // the other four are identical so the median lands exactly on the case
    // under test.
    function scenario(id: string) {
      return {
        conn: connection({ id, sentAt: "2026-06-01T00:00:00.000Z", hiredAt: "2026-06-21T00:00:00.000Z" }),
        events: [
          event({ connectionId: id, toStatus: "proposed", at: "2026-06-01T00:00:00.000Z" }),
          event({ connectionId: id, toStatus: "sent", at: "2026-06-01T00:00:00.000Z" }),
          event({ connectionId: id, toStatus: "interested", at: "2026-06-03T00:00:00.000Z" }),
          event({ connectionId: id, toStatus: "hired", at: "2026-06-21T00:00:00.000Z" }),
        ],
      };
    }
    const scenarios = ["a", "b", "c", "d", "e"].map(scenario);
    const result = computeFunnel(
      scenarios.map((s) => s.conn),
      scenarios.flatMap((s) => s.events),
    );
    assert.equal(result.medians.sendToResponseDays, 2, "must read the day-2 'interested' event, not day-20 'hired'");
    assert.equal(
      result.medians.sendToHireDays,
      20,
      "sendToHireDays is unaffected — it still reads Connection.hiredAt directly",
    );
  });

  it("an earlier not_now still counts as the response event (a decline is a response)", () => {
    function scenario(id: string) {
      return {
        conn: connection({ id, sentAt: "2026-06-01T00:00:00.000Z" }),
        events: [
          event({ connectionId: id, toStatus: "sent", at: "2026-06-01T00:00:00.000Z" }),
          event({ connectionId: id, toStatus: "not_now", at: "2026-06-04T00:00:00.000Z" }),
        ],
      };
    }
    const scenarios = ["a", "b", "c", "d", "e"].map(scenario);
    const result = computeFunnel(
      scenarios.map((s) => s.conn),
      scenarios.flatMap((s) => s.events),
    );
    assert.equal(result.medians.sendToResponseDays, 3);
  });

  it("a mere 'viewed' event is NOT a response — it must not shorten the response time", () => {
    function scenario(id: string) {
      return {
        conn: connection({ id, sentAt: "2026-06-01T00:00:00.000Z" }),
        events: [
          event({ connectionId: id, toStatus: "sent", at: "2026-06-01T00:00:00.000Z" }),
          event({ connectionId: id, toStatus: "viewed", at: "2026-06-02T00:00:00.000Z" }),
          event({ connectionId: id, toStatus: "interested", at: "2026-06-06T00:00:00.000Z" }),
        ],
      };
    }
    const scenarios = ["a", "b", "c", "d", "e"].map(scenario);
    const result = computeFunnel(
      scenarios.map((s) => s.conn),
      scenarios.flatMap((s) => s.events),
    );
    assert.equal(result.medians.sendToResponseDays, 5);
  });
});

describe("computeFunnel — empty input returns nulls, not zeros", () => {
  it("medians are null, not 0, when nothing qualifies", () => {
    const result = computeFunnel([], []);
    assert.equal(result.medians.sendToResponseDays, null);
    assert.equal(result.medians.sendToHireDays, null);
  });

  it("every stage count is 0 and every array is empty on a fully empty input", () => {
    const result = computeFunnel([], []);
    assert.ok(result.stages.every((s) => s.count === 0));
    assert.deepEqual(result.exits, { not_now: 0, withdrawn: 0, closed: 0 });
    assert.deepEqual(result.byEmployer, []);
    assert.deepEqual(result.byClass, []);
    assert.equal(result.comparison.selfDirectedApplications, 0);
    assert.equal(result.comparison.selfDirectedAcceptedVerified, 0);
  });
});

describe("computeFunnel — subsidy split", () => {
  function packetWithSubsidy(subsidyLine: string | null) {
    return {
      resumeVersionId: null,
      coverLetterId: null,
      resumeFileUploadId: null,
      endorsement: "Great work.",
      includedCertIds: [],
      includedFields: ["candidate_name"],
      candidateName: "Dana R.",
      certifications: [],
      availabilitySummary: "Weekdays",
      earliestStart: null,
      subsidyLine,
    };
  }

  it("splits attached vs not-attached by packet.subsidyLine", () => {
    const connections = [
      connection({ id: "c1", packet: packetWithSubsidy("WV Works EIP: half the wage.") }),
      connection({ id: "c2", packet: packetWithSubsidy(null) }),
      connection({ id: "c3", packet: null }),
    ];
    const result = computeFunnel(connections, []);
    assert.equal(result.subsidy.attached, 1);
    assert.equal(result.subsidy.notAttached, 2);
  });

  it("splits hired-with-subsidy vs hired-without, ignoring connections never hired", () => {
    const connections = [
      connection({ id: "c1", hiredAt: "2026-06-10", packet: packetWithSubsidy("EIP: half the wage.") }),
      connection({ id: "c2", hiredAt: "2026-06-10", packet: packetWithSubsidy(null) }),
      connection({ id: "c3", hiredAt: null, packet: packetWithSubsidy("EIP: half the wage.") }),
    ];
    const result = computeFunnel(connections, []);
    assert.equal(result.subsidy.hiredWithSubsidy, 1);
    assert.equal(result.subsidy.hiredWithout, 1);
  });

  it("counts a non-null but schema-invalid packet as packetUnparseable, not as notAttached silently", () => {
    const connections = [
      connection({ id: "c1", packet: { garbage: true } }),
      connection({ id: "c2", packet: packetWithSubsidy(null) }),
      connection({ id: "c3", packet: null }),
    ];
    const result = computeFunnel(connections, []);
    assert.equal(result.subsidy.packetUnparseable, 1);
    // All three (c1 unparseable, c2 parseable-but-no-line, c3 null) land in
    // notAttached too — packetUnparseable is an ADDITIONAL signal, not a
    // replacement bucket.
    assert.equal(result.subsidy.notAttached, 3);
  });

  it("a legitimately absent packet (null — e.g. still 'proposed') is NOT counted as unparseable", () => {
    const connections = [connection({ id: "c1", packet: null })];
    const result = computeFunnel(connections, []);
    assert.equal(result.subsidy.packetUnparseable, 0);
  });
});

describe("computeFunnel — comparison line (self-directed applications)", () => {
  function selfDirected(
    overrides: Partial<SelfDirectedApplicationRow> = {},
  ): SelfDirectedApplicationRow {
    return {
      id: "app-1",
      studentId: "student-1",
      createdAt: "2026-06-05T00:00:00.000Z",
      status: "applied",
      verificationStatus: null,
      ...overrides,
    };
  }

  it("counts self-directed applications in the period, separate from accepted+verified", () => {
    const result = computeFunnel([], [], {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      selfDirectedApplications: [
        selfDirected({ id: "a1" }),
        selfDirected({ id: "a2", status: "accepted", verificationStatus: "verified" }),
        selfDirected({ id: "a3", status: "accepted", verificationStatus: "self_reported" }),
      ],
    });
    assert.equal(result.comparison.selfDirectedApplications, 3);
    assert.equal(result.comparison.selfDirectedAcceptedVerified, 1);
  });

  it("applies the same period filter to self-directed applications as to connections", () => {
    const result = computeFunnel([], [], {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      selfDirectedApplications: [selfDirected({ id: "out", createdAt: "2026-01-01T00:00:00.000Z" })],
    });
    assert.equal(result.comparison.selfDirectedApplications, 0);
  });

  it("requires BOTH accepted status and verified status, not either alone", () => {
    const result = computeFunnel([], [], {
      selfDirectedApplications: [
        selfDirected({ id: "a1", status: "accepted", verificationStatus: "self_reported" }),
        selfDirected({ id: "a2", status: "applied", verificationStatus: "verified" }),
      ],
    });
    assert.equal(result.comparison.selfDirectedAcceptedVerified, 0);
  });
});

describe("computeFunnel — byEmployer / byClass", () => {
  it("groups by employer and by class, and flags hired count", () => {
    const connections = [
      connection({ id: "c1", employerId: "e1", employerName: "Mountain Metals", classId: "cl1", className: "Fall" }),
      connection({
        id: "c2",
        employerId: "e1",
        employerName: "Mountain Metals",
        classId: "cl1",
        className: "Fall",
        hiredAt: "2026-06-10",
      }),
      connection({
        id: "c3",
        employerId: "e2",
        employerName: "River Foods",
        classId: null,
        className: null,
      }),
    ];
    const result = computeFunnel(connections, []);

    const mountain = result.byEmployer.find((row) => row.employerId === "e1");
    assert.deepEqual(mountain, { employerId: "e1", employerName: "Mountain Metals", total: 2, hired: 1 });

    const river = result.byEmployer.find((row) => row.employerId === "e2");
    assert.deepEqual(river, { employerId: "e2", employerName: "River Foods", total: 1, hired: 0 });

    const fall = result.byClass.find((row) => row.classId === "cl1");
    assert.deepEqual(fall, { classId: "cl1", className: "Fall", total: 2, hired: 1 });

    const programWide = result.byClass.find((row) => row.classId === null);
    assert.equal(programWide?.total, 1);
  });
});

describe("FUNNEL_STAGE_ORDER", () => {
  it("excludes the three exit statuses", () => {
    for (const exit of ["not_now", "withdrawn", "closed"]) {
      assert.ok(!(FUNNEL_STAGE_ORDER as readonly string[]).includes(exit));
    }
  });

  it("matches the plan's stated order exactly", () => {
    assert.deepEqual(FUNNEL_STAGE_ORDER, [
      "proposed",
      "student_approved",
      "sent",
      "viewed",
      "interested",
      "interview_scheduled",
      "offered",
      "hired",
      "started",
      "retained_30",
      "retained_60",
      "retained_90",
    ]);
  });
});
