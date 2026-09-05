import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_TRANSITIONS,
  CONNECTION_STATUSES,
  CONNECTION_STATUS_LABELS,
  EMPLOYER_LINK_ACTIVE_STATUSES,
  STUDENT_ALLOWED_TRANSITIONS,
  TERMINAL_CONNECTION_STATUSES,
  TransitionNotAllowedError,
  assertTransition,
  canTransition,
  isPostHireStatus,
  isTerminalConnectionStatus,
  type ConnectionStatus,
} from "./pipeline-shared";

/**
 * The whole point of this suite is that it enumerates EVERY (from, to) pair
 * — 15 x 15 = 225 — and asserts each one against an expectation written out
 * here by hand. A table-driven test that only checked the legal pairs would
 * pass just as happily if the table let everything through.
 */
const LEGAL: Record<ConnectionStatus, ConnectionStatus[]> = {
  proposed: ["student_approved", "withdrawn", "closed"],
  student_approved: ["sent", "withdrawn", "closed"],
  sent: ["viewed", "interested", "not_now", "hired", "withdrawn", "closed"],
  viewed: ["interested", "not_now", "hired", "withdrawn", "closed"],
  interested: ["interview_scheduled", "offered", "hired", "not_now", "withdrawn", "closed"],
  interview_scheduled: ["offered", "hired", "not_now", "withdrawn", "closed"],
  offered: ["hired", "not_now", "withdrawn", "closed"],
  hired: ["started", "withdrawn", "closed"],
  started: ["retained_30", "withdrawn", "closed"],
  retained_30: ["retained_60", "withdrawn", "closed"],
  retained_60: ["retained_90", "withdrawn", "closed"],
  retained_90: [],
  not_now: [],
  withdrawn: [],
  closed: [],
};

describe("connection pipeline — every transition pair", () => {
  it("declares 15 statuses and an entry for each", () => {
    assert.equal(CONNECTION_STATUSES.length, 15);
    for (const status of CONNECTION_STATUSES) {
      assert.ok(ALLOWED_TRANSITIONS[status], `no transition entry for ${status}`);
      assert.equal(typeof CONNECTION_STATUS_LABELS[status], "string");
    }
  });

  for (const from of Object.keys(LEGAL) as ConnectionStatus[]) {
    for (const to of Object.keys(LEGAL) as ConnectionStatus[]) {
      const expected = LEGAL[from].includes(to);
      it(`${from} -> ${to} is ${expected ? "legal" : "ILLEGAL"}`, () => {
        assert.equal(canTransition(from, to), expected);
        if (expected) {
          assert.doesNotThrow(() => assertTransition(from, to));
        } else {
          assert.throws(() => assertTransition(from, to), TransitionNotAllowedError);
        }
      });
    }
  }

  it("never allows a status to transition to itself", () => {
    for (const status of CONNECTION_STATUSES) {
      assert.equal(canTransition(status, status), false, `${status} -> ${status}`);
    }
  });

  it("treats not_now, withdrawn, closed and retained_90 as terminal", () => {
    assert.deepEqual(
      [...TERMINAL_CONNECTION_STATUSES].sort(),
      ["closed", "not_now", "retained_90", "withdrawn"],
    );
    for (const status of CONNECTION_STATUSES) {
      assert.equal(
        isTerminalConnectionStatus(status),
        (TERMINAL_CONNECTION_STATUSES as readonly string[]).includes(status),
        status,
      );
      // A terminal status has no outgoing transitions, and a non-terminal one
      // always has at least "withdrawn" and "closed".
      assert.equal(
        ALLOWED_TRANSITIONS[status].length === 0,
        isTerminalConnectionStatus(status),
        `${status} terminality disagrees with its transition list`,
      );
    }
  });

  it("lets a student withdraw before a hire, never after, and approve only from proposed", () => {
    for (const status of CONNECTION_STATUSES) {
      const allowed = STUDENT_ALLOWED_TRANSITIONS[status] ?? [];
      if (isTerminalConnectionStatus(status)) {
        assert.deepEqual(allowed, [], `${status} is terminal — the student may do nothing`);
        continue;
      }
      if (isPostHireStatus(status)) {
        // Withdrawing means "don't send this / stop this going further". After
        // a hire it would mean rewriting a verified placement — the row names
        // an accepted, instructor-verified Application and feeds the grant KPI
        // report and the DoHS export, so a one-tap "take this back" would
        // leave the two records disagreeing about whether the person is
        // employed. Fixing a wrongly recorded hire is a conversation with the
        // instructor, who can close the connection and unverify the
        // Application together.
        assert.deepEqual(
          allowed,
          [],
          `a student must not drive a "${status}" connection anywhere`,
        );
        continue;
      }
      assert.ok(allowed.includes("withdrawn"), `student cannot withdraw from ${status}`);
      assert.equal(
        allowed.includes("student_approved"),
        status === "proposed",
        `student approval must be reachable only from proposed (saw ${status})`,
      );
      // Whatever the student may do must also be legal in the main table.
      for (const to of allowed) {
        assert.ok(canTransition(status, to), `student transition ${status} -> ${to} is not legal`);
      }
      // Sending and every employer response stay off the student's list.
      for (const forbidden of ["sent", "viewed", "interested", "not_now", "hired"] as const) {
        assert.ok(
          !allowed.includes(forbidden),
          `a student must never drive ${status} -> ${forbidden}`,
        );
      }
    }
  });

  it("keeps the employer link active only while a response is still wanted", () => {
    assert.deepEqual(
      [...EMPLOYER_LINK_ACTIVE_STATUSES].sort(),
      ["interested", "interview_scheduled", "offered", "sent", "viewed"],
    );
    // The task's replay case: once the employer has said "hired", the link is
    // no longer active, so a second tap renders the neutral page.
    assert.ok(!(EMPLOYER_LINK_ACTIVE_STATUSES as readonly string[]).includes("hired"));
    for (const status of TERMINAL_CONNECTION_STATUSES) {
      assert.ok(
        !(EMPLOYER_LINK_ACTIVE_STATUSES as readonly string[]).includes(status),
        status,
      );
    }
  });

  it("names both statuses in the error it throws", () => {
    let error: TransitionNotAllowedError | null = null;
    try {
      assertTransition("hired", "sent");
    } catch (caught) {
      error = caught as TransitionNotAllowedError;
    }
    assert.ok(error instanceof TransitionNotAllowedError);
    assert.equal(error.from, "hired");
    assert.equal(error.to, "sent");
    assert.match(error.message, /hired/);
    assert.match(error.message, /sent/);
  });
});
