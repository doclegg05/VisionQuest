import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FUNNEL_STAGE_ORDER,
  computeFunnel,
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
    employerRespondedAt: null,
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
    const connections = [connection({ id: "c1", status: "interested" })];
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
    const connections = [connection({ id: "c1", status: "closed" })];
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

  it("excludes a connection created after `to`", () => {
    const connections = [connection({ id: "c1", createdAt: "2026-07-01T00:00:01.000Z" })];
    const result = computeFunnel(connections, [], { to: "2026-07-01T00:00:00.000Z" });
    assert.equal(result.stages.reduce((s, r) => s + r.count, 0), 0);
  });

  it("includes a connection created exactly at `to` (inclusive upper bound)", () => {
    const connections = [connection({ id: "c1", createdAt: "2026-07-01T00:00:00.000Z" })];
    const result = computeFunnel(connections, [], { to: "2026-07-01T00:00:00.000Z" });
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
      to: "2026-06-30T00:00:00.000Z",
    });
    assert.equal(stageCount(result, "hired"), 0);
    assert.equal(stageCount(result, "proposed"), 1);
  });
});

describe("computeFunnel — medians", () => {
  it("send-to-response median over an ODD count of values", () => {
    // days: 1, 3, 5 -> nearest-rank p50 of 3 values is the 2nd (index 1) = 3
    const connections = [
      connection({ id: "c1", sentAt: "2026-06-01", employerRespondedAt: "2026-06-02" }),
      connection({ id: "c2", sentAt: "2026-06-01", employerRespondedAt: "2026-06-04" }),
      connection({ id: "c3", sentAt: "2026-06-01", employerRespondedAt: "2026-06-06" }),
    ];
    const result = computeFunnel(connections, []);
    assert.equal(result.medians.sendToResponseDays, 3);
  });

  it("send-to-response median over an EVEN count of values (nearest-rank, lower-middle)", () => {
    // days: 2, 4, 6, 8 -> nearest-rank p50 of 4 values is the 2nd (index 1) = 4
    const connections = [
      connection({ id: "c1", sentAt: "2026-06-01", employerRespondedAt: "2026-06-03" }),
      connection({ id: "c2", sentAt: "2026-06-01", employerRespondedAt: "2026-06-05" }),
      connection({ id: "c3", sentAt: "2026-06-01", employerRespondedAt: "2026-06-07" }),
      connection({ id: "c4", sentAt: "2026-06-01", employerRespondedAt: "2026-06-09" }),
    ];
    const result = computeFunnel(connections, []);
    assert.equal(result.medians.sendToResponseDays, 4);
  });

  it("send-to-hire median only counts connections with both sentAt and hiredAt", () => {
    const connections = [
      connection({ id: "c1", sentAt: "2026-06-01", hiredAt: "2026-06-11" }),
      connection({ id: "c2", sentAt: "2026-06-01", hiredAt: null }),
      connection({ id: "c3", sentAt: null, hiredAt: "2026-06-20" }),
    ];
    const result = computeFunnel(connections, []);
    assert.equal(result.medians.sendToHireDays, 10);
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
      to: "2026-06-30T00:00:00.000Z",
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
      to: "2026-06-30T00:00:00.000Z",
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
