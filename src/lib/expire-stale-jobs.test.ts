import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPIRED_STATUS,
  buildExpiryError,
  parseExpireArgs,
  planExpiry,
  formatExpiryPlan,
} from "../../scripts/lib/expire-stale-jobs.mjs";

const NOW = new Date("2026-09-02T12:00:00Z");

describe("EXPIRED_STATUS (scripts/lib/expire-stale-jobs.mjs)", () => {
  it("is 'failed' — the only terminal status src/lib/jobs.ts already writes for a job that will not run", () => {
    assert.equal(EXPIRED_STATUS, "failed");
  });
});

describe("parseExpireArgs", () => {
  it("requires --before", () => {
    const result = parseExpireArgs({ reason: "x" }, { now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /--before/);
  });

  it("requires --reason", () => {
    const result = parseExpireArgs({ before: "2026-06-01" }, { now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /--reason/);
  });

  it("rejects a --before that is not an ISO date", () => {
    const result = parseExpireArgs({ before: "yesterday", reason: "x" }, { now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /ISO/);
  });

  it("rejects a --before in the future (it would expire jobs that are not stale)", () => {
    const result = parseExpireArgs({ before: "2027-01-01", reason: "x" }, { now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /future/);
  });

  it("rejects a bare --before flag with no value", () => {
    const result = parseExpireArgs({ before: true, reason: "x" }, { now: NOW });
    assert.equal(result.ok, false);
  });

  it("defaults to dry-run; --apply flips it", () => {
    const dry = parseExpireArgs({ before: "2026-06-01", reason: "queue never drained" }, { now: NOW });
    assert.equal(dry.ok, true);
    if (dry.ok) {
      assert.equal(dry.apply, false);
      assert.equal(dry.before.toISOString(), "2026-06-01T00:00:00.000Z");
      assert.equal(dry.reason, "queue never drained");
    }
    const apply = parseExpireArgs({ before: "2026-06-01T00:00:00Z", reason: "r", apply: true }, { now: NOW });
    assert.equal(apply.ok, true);
    if (apply.ok) assert.equal(apply.apply, true);
  });
});

describe("buildExpiryError", () => {
  it("matches the runbook wording: expired by operator on <today>: <reason>", () => {
    assert.equal(
      buildExpiryError({ today: "2026-09-02", reason: "pg_cron job-processor never ran; F1 repair" }),
      "expired by operator on 2026-09-02: pg_cron job-processor never ran; F1 repair"
    );
  });
});

describe("planExpiry", () => {
  const before = new Date("2026-06-01T00:00:00Z");

  it("targets only pending rows created before the cutoff and sets a terminal status", () => {
    const plan = planExpiry({ groups: [], before, today: "2026-09-02", reason: "r" });
    assert.deepEqual(plan.where, { status: "pending", createdAt: { lt: before } });
    assert.deepEqual(plan.data, { status: "failed", error: "expired by operator on 2026-09-02: r" });
  });

  it("sums the per-type counts and sorts by count desc, then type", () => {
    const plan = planExpiry({
      groups: [
        { type: "send_email", count: 120 },
        { type: "chat_post_response", count: 30 },
        { type: "a_tie", count: 30 },
      ],
      before,
      today: "2026-09-02",
      reason: "r",
    });
    assert.equal(plan.total, 180);
    assert.deepEqual(plan.byType, [
      { type: "send_email", count: 120 },
      { type: "a_tie", count: 30 },
      { type: "chat_post_response", count: 30 },
    ]);
  });

  it("does not mutate the groups it is given", () => {
    const groups = [
      { type: "b", count: 1 },
      { type: "a", count: 2 },
    ];
    const snapshot = JSON.stringify(groups);
    planExpiry({ groups, before, today: "2026-09-02", reason: "r" });
    assert.equal(JSON.stringify(groups), snapshot);
  });
});

describe("formatExpiryPlan", () => {
  it("prints counts by type and never a payload", () => {
    const plan = planExpiry({
      groups: [{ type: "send_email", count: 2 }],
      before: new Date("2026-06-01T00:00:00Z"),
      today: "2026-09-02",
      reason: "r",
    });
    const text = formatExpiryPlan({ label: "before", plan }).join("\n");
    assert.match(text, /before: 2 pending BackgroundJob rows created before 2026-06-01T00:00:00.000Z/);
    assert.match(text, /send_email=2/);
    assert.doesNotMatch(text, /payload/i);
  });

  it("says so when nothing matches", () => {
    const plan = planExpiry({ groups: [], before: new Date("2026-06-01T00:00:00Z"), today: "2026-09-02", reason: "r" });
    const text = formatExpiryPlan({ label: "after", plan }).join("\n");
    assert.match(text, /after: 0 pending BackgroundJob rows/);
  });
});
