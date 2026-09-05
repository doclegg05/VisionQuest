import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCohortDateTime,
  monthBoundsInZone,
  programYearBoundsUtc,
  programYearNumber,
  reportDateRangeBoundsUtc,
  zonedTimeToUtc,
} from "./timezone";

describe("formatCohortDateTime (America/New_York)", () => {
  it("renders a UTC instant as cohort-local wall-clock", () => {
    // 2026-06-29 18:30 UTC = 2:30 PM EDT (UTC-4).
    const out = formatCohortDateTime("2026-06-29T18:30:00.000Z");
    assert.match(out, /Mon/);
    assert.match(out, /Jun 29/);
    assert.match(out, /2:30/);
    assert.match(out, /PM/);
  });

  it("accepts a Date as well as a string", () => {
    const out = formatCohortDateTime(new Date("2026-01-05T14:00:00.000Z"));
    // EST (UTC-5) → 9:00 AM.
    assert.match(out, /9:00/);
    assert.match(out, /AM/);
  });
});

describe("zonedTimeToUtc (America/New_York)", () => {
  it("maps ET midnight to the correct UTC instant during EDT (UTC-4)", () => {
    // July 1 2025 00:00 ET = 04:00 UTC.
    assert.equal(zonedTimeToUtc(2025, 7, 1).toISOString(), "2025-07-01T04:00:00.000Z");
  });

  it("maps ET midnight to the correct UTC instant during EST (UTC-5)", () => {
    // Jan 1 2026 00:00 ET = 05:00 UTC.
    assert.equal(zonedTimeToUtc(2026, 1, 1).toISOString(), "2026-01-01T05:00:00.000Z");
  });
});

describe("monthBoundsInZone", () => {
  it("anchors to ET month start, not UTC", () => {
    const { start, end } = monthBoundsInZone(new Date("2026-06-15T12:00:00Z"));
    assert.equal(start.toISOString(), "2026-06-01T04:00:00.000Z");
    assert.equal(end.toISOString(), "2026-07-01T04:00:00.000Z");
  });

  it("classifies a UTC-next-day-but-ET-same-month instant into the ET month", () => {
    // 2026-07-01T03:00Z = June 30 11pm EDT → still June.
    const { start, end } = monthBoundsInZone(new Date("2026-07-01T03:00:00Z"));
    assert.equal(start.toISOString(), "2026-06-01T04:00:00.000Z");
    assert.equal(end.toISOString(), "2026-07-01T04:00:00.000Z");
  });
});

describe("programYearNumber / programYearBoundsUtc", () => {
  it("uses ET wall clock for the July boundary", () => {
    assert.equal(programYearNumber(new Date("2026-07-01T00:00:00Z")), 2026); // June 30 8pm ET
    assert.equal(programYearNumber(new Date("2026-07-01T04:00:00Z")), 2027); // July 1 midnight ET
  });

  it("returns ET-anchored program-year bounds", () => {
    const { start, end } = programYearBoundsUtc(2026);
    assert.equal(start.toISOString(), "2025-07-01T04:00:00.000Z");
    assert.equal(end.toISOString(), "2026-07-01T04:00:00.000Z");
  });
});

describe("reportDateRangeBoundsUtc", () => {
  it("expands `from` to the ET start of that calendar day", () => {
    const { from } = reportDateRangeBoundsUtc("2026-06-01", undefined);
    // June 1 2026 00:00 ET (EDT, UTC-4) = 04:00 UTC.
    assert.equal(from?.toISOString(), "2026-06-01T04:00:00.000Z");
  });

  it("expands `to` to the EXCLUSIVE ET start of the NEXT calendar day — the last day is not dropped", () => {
    const { to } = reportDateRangeBoundsUtc(undefined, "2026-06-30");
    // A naive `new Date("2026-06-30")` gives 2026-06-30T00:00:00.000Z, which
    // is 8pm ET on June 29 — everything from 8pm June 29 through midnight ET
    // June 30/July 1 would be wrongly excluded. The correct exclusive bound
    // is ET midnight starting July 1.
    assert.equal(to?.toISOString(), "2026-07-01T04:00:00.000Z");
    assert.notEqual(to?.toISOString(), new Date("2026-06-30").toISOString());
  });

  it("a connection created at 9:30pm ET on the `to` day is still inside the range", () => {
    const { to } = reportDateRangeBoundsUtc(undefined, "2026-06-30");
    // 2026-07-01T01:30:00Z = 2026-06-30 9:30 PM EDT.
    const createdAt = new Date("2026-07-01T01:30:00.000Z");
    assert.ok(to && createdAt.getTime() < to.getTime(), "9:30pm ET on the to-day must be < the exclusive bound");
  });

  it("an instant exactly at the exclusive `to` bound (ET midnight of the next day) is NOT included", () => {
    const { to } = reportDateRangeBoundsUtc(undefined, "2026-06-30");
    assert.ok(to);
    // Exactly midnight ET July 1 — the caller's own `< to` check must exclude
    // this; reportDateRangeBoundsUtc's job is only to return the right instant.
    assert.equal(to!.toISOString(), "2026-07-01T04:00:00.000Z");
  });

  it("rolls over a month and a year correctly (Dec 31 -> Jan 1)", () => {
    const { to } = reportDateRangeBoundsUtc(undefined, "2025-12-31");
    // Jan 1 2026 00:00 ET (EST, UTC-5) = 05:00 UTC.
    assert.equal(to?.toISOString(), "2026-01-01T05:00:00.000Z");
  });

  it("returns undefined for an omitted bound", () => {
    const bounds = reportDateRangeBoundsUtc(undefined, undefined);
    assert.equal(bounds.from, undefined);
    assert.equal(bounds.to, undefined);
  });

  it("passes a non-date-only string straight to `new Date()` rather than mangling it", () => {
    const { from } = reportDateRangeBoundsUtc("2026-06-01T14:00:00.000Z", undefined);
    assert.equal(from?.toISOString(), "2026-06-01T14:00:00.000Z");
  });
});
