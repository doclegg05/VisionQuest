import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  availabilityOverlap,
  emptyAvailability,
  transportFeasible,
  workProfileInputSchema,
  type AvailabilityDay,
  type AvailabilityGrid,
  type AvailabilitySlot,
} from "./work-profile-shared";

/**
 * Task 2.1 of the Match & Connect plan. These cover
 * src/lib/connect/work-profile-shared.ts — the grid math, the transport
 * matrix, and the Zod schema — which Phase 3's matcher will use as hard
 * blocks. Nothing here touches a database, and the module under test imports
 * no server-only code (see client-import-guard.test.ts for why that matters).
 */

/**
 * Round an overlap for comparison. Asserts it is a number first: since
 * availabilityOverlap may return null for "nothing declared", a null slipping
 * into a ratio assertion must fail loudly rather than compare as NaN.
 */
function rounded(value: number | null): string {
  assert.ok(value !== null, "expected a declared overlap, got null");
  return value.toFixed(4);
}

function gridWith(cells: Partial<Record<AvailabilityDay, AvailabilitySlot[]>>): AvailabilityGrid {
  const grid = emptyAvailability();
  for (const [day, slots] of Object.entries(cells)) {
    for (const slot of slots ?? []) {
      grid[day as AvailabilityDay][slot] = true;
    }
  }
  return grid;
}

describe("availability grid", () => {
  it("is 7 days by 4 slots and starts all-false", () => {
    const grid = emptyAvailability();
    assert.equal(AVAILABILITY_DAYS.length, 7);
    assert.equal(AVAILABILITY_SLOTS.length, 4);
    const trueCells = AVAILABILITY_DAYS.flatMap((day) =>
      AVAILABILITY_SLOTS.filter((slot) => grid[day][slot]),
    );
    assert.deepEqual(trueCells, []);
  });
});

describe("availabilityOverlap", () => {
  it("returns 1 when every requested cell is available", () => {
    const profile = {
      availability: gridWith({
        monday: ["morning", "afternoon"],
        tuesday: ["morning", "afternoon"],
        wednesday: ["morning", "afternoon"],
        thursday: ["morning", "afternoon"],
        friday: ["morning", "afternoon"],
      }),
    };
    assert.equal(availabilityOverlap(profile, { shifts: ["day"] }), 1);
  });

  it("returns 0 when no requested cell is available", () => {
    const profile = { availability: gridWith({ saturday: ["morning"], sunday: ["morning"] }) };
    assert.equal(availabilityOverlap(profile, { shifts: ["day"] }), 0);
  });

  it("returns the fraction of the requested cells the student can work", () => {
    // Day shift is the 10 weekday morning+afternoon cells; 5 of them are open.
    const profile = {
      availability: gridWith({
        monday: ["morning", "afternoon"],
        tuesday: ["morning", "afternoon"],
        wednesday: ["morning"],
      }),
    };
    assert.equal(availabilityOverlap(profile, { shifts: ["day"] }), 0.5);
  });

  it("maps evening to weekday evenings only", () => {
    const profile = { availability: gridWith({ monday: ["evening"], saturday: ["evening"] }) };
    // 1 of the 5 weekday evening cells; Saturday belongs to the weekend shift.
    assert.equal(availabilityOverlap(profile, { shifts: ["evening"] }), 0.2);
  });

  it("maps night to weekday overnight only", () => {
    const profile = {
      availability: gridWith({
        monday: ["overnight"],
        tuesday: ["overnight"],
        wednesday: ["overnight"],
        thursday: ["overnight"],
        friday: ["overnight"],
      }),
    };
    assert.equal(availabilityOverlap(profile, { shifts: ["night"] }), 1);
  });

  it("maps weekend to any Saturday or Sunday cell", () => {
    const profile = {
      availability: gridWith({ saturday: ["morning", "afternoon", "evening", "overnight"] }),
    };
    // 4 of the 8 Sat/Sun cells.
    assert.equal(availabilityOverlap(profile, { shifts: ["weekend"] }), 0.5);
  });

  it("unions the cells of several shifts instead of averaging them", () => {
    const profile = { availability: gridWith({ monday: ["evening"] }) };
    // day (10 cells) + evening (5 cells) = 15 requested, 1 available.
    assert.equal(
      Number(rounded(availabilityOverlap(profile, { shifts: ["day", "evening"] }))),
      Number((1 / 15).toFixed(4)),
    );
  });

  it("counts a repeated shift once", () => {
    const profile = { availability: gridWith({ monday: ["evening"] }) };
    assert.equal(availabilityOverlap(profile, { shifts: ["evening", "evening"] }), 0.2);
  });

  it("covers all 28 cells when every shift is requested", () => {
    const full = emptyAvailability();
    for (const day of AVAILABILITY_DAYS) {
      for (const slot of AVAILABILITY_SLOTS) full[day][slot] = true;
    }
    assert.equal(
      availabilityOverlap({ availability: full }, { shifts: ["day", "evening", "night", "weekend"] }),
      1,
    );
    // And one missing cell is visible in the denominator: 27/28.
    full.sunday.overnight = false;
    assert.equal(
      Number(
        rounded(
          availabilityOverlap(
            { availability: full },
            { shifts: ["day", "evening", "night", "weekend"] },
          ),
        ),
      ),
      Number((27 / 28).toFixed(4)),
    );
  });

  it("returns 1 for a lead that states no shifts, so an unrecorded schedule blocks nobody", () => {
    const profile = { availability: emptyAvailability() };
    assert.equal(availabilityOverlap(profile, { shifts: [] }), 1);
  });

  it("returns null, not 0, when the student has not declared any availability", () => {
    // Spec §5 makes an overlap of 0 a HARD BLOCK. upsertWorkProfile creates an
    // all-false grid whenever a student answers only, say, their pay floor, so
    // returning 0 here would hide every lead from every student who skipped
    // the grid. "Not declared" has to be its own answer.
    assert.equal(availabilityOverlap({ availability: emptyAvailability() }, { shifts: ["day"] }), null);
    assert.equal(availabilityOverlap(null, { shifts: ["day"] }), null);
    assert.equal(availabilityOverlap(undefined, { shifts: ["day"] }), null);
  });

  it("still returns 0 for a real mismatch, so the hard block keeps working", () => {
    // Weekend-only availability against a weekday day shift: declared, and
    // genuinely incompatible.
    const profile = { availability: gridWith({ saturday: ["morning"], sunday: ["morning"] }) };
    assert.equal(availabilityOverlap(profile, { shifts: ["day"] }), 0);
  });
});

describe("transportFeasible", () => {
  const noLead = { transitNotes: null, distanceMiles: null };

  it("says yes for a car or a ride, whatever the posting says", () => {
    assert.equal(transportFeasible({ transport: "car" }, noLead), "yes");
    assert.equal(transportFeasible({ transport: "ride" }, noLead), "yes");
    assert.equal(
      transportFeasible({ transport: "car" }, { transitNotes: null, distanceMiles: 90 }),
      "yes",
    );
  });

  it("says yes for the bus only when the posting names a transit route", () => {
    assert.equal(
      transportFeasible(
        { transport: "bus" },
        { transitNotes: "Route 4 stops out front", distanceMiles: null },
      ),
      "yes",
    );
    assert.equal(transportFeasible({ transport: "bus" }, noLead), "unknown");
    assert.equal(
      transportFeasible({ transport: "bus" }, { transitNotes: "   ", distanceMiles: null }),
      "unknown",
    );
  });

  it("honours a transit note for a walker, the same way it does for someone with no ride", () => {
    // The two branches disagreed: `none` + a transit note was "yes" while
    // `walk` + the same note fell through to the distance rule and could
    // return "no". A student who walks can also take the bus that stops out
    // front — the note is the same evidence either way.
    assert.equal(
      transportFeasible(
        { transport: "walk" },
        { transitNotes: "Route 4 stops out front", distanceMiles: 12 },
      ),
      "yes",
    );
  });

  it("walks up to two miles, and no further", () => {
    assert.equal(
      transportFeasible({ transport: "walk" }, { transitNotes: null, distanceMiles: 1.2 }),
      "yes",
    );
    assert.equal(
      transportFeasible({ transport: "walk" }, { transitNotes: null, distanceMiles: 2 }),
      "yes",
    );
    assert.equal(
      transportFeasible({ transport: "walk" }, { transitNotes: null, distanceMiles: 2.1 }),
      "no",
    );
    assert.equal(transportFeasible({ transport: "walk" }, noLead), "unknown");
  });

  it("says no with no way to get there, unless the posting names transit", () => {
    assert.equal(transportFeasible({ transport: "none" }, noLead), "no");
    assert.equal(
      transportFeasible(
        { transport: "none" },
        { transitNotes: "On the Route 4 line", distanceMiles: null },
      ),
      "yes",
    );
  });

  it("says unknown when the student has not answered the transport question", () => {
    assert.equal(transportFeasible({ transport: null }, noLead), "unknown");
    assert.equal(transportFeasible(null, noLead), "unknown");
  });
});

describe("workProfileInputSchema", () => {
  it("accepts a full five-question answer set", () => {
    const parsed = workProfileInputSchema.parse({
      availability: emptyAvailability(),
      transport: "bus",
      payFloorHourly: 15,
      earliestStart: "2026-10-01",
      childcareHours: { note: "Kids are at school 8 to 3." },
    });
    assert.equal(parsed.transport, "bus");
    assert.equal(parsed.payFloorHourly, 15);
  });

  it("rejects an unknown transport mode", () => {
    assert.equal(workProfileInputSchema.safeParse({ transport: "helicopter" }).success, false);
  });

  it("rejects an availability grid that is missing a day", () => {
    const grid = emptyAvailability() as unknown as Record<string, unknown>;
    delete grid.sunday;
    assert.equal(workProfileInputSchema.safeParse({ availability: grid }).success, false);
  });

  it("rejects unknown keys so a caller cannot smuggle a column in", () => {
    assert.equal(
      workProfileInputSchema.safeParse({ studentId: "someone-else", payFloorHourly: 15 }).success,
      false,
    );
  });

  it("rejects a negative or implausible pay floor", () => {
    assert.equal(workProfileInputSchema.safeParse({ payFloorHourly: -1 }).success, false);
    assert.equal(workProfileInputSchema.safeParse({ payFloorHourly: 5000 }).success, false);
  });

  it("rejects an earliestStart that is not a plain date", () => {
    assert.equal(workProfileInputSchema.safeParse({ earliestStart: "next Tuesday" }).success, false);
    assert.equal(workProfileInputSchema.safeParse({ earliestStart: "2026-10-01" }).success, true);
  });

  it("rejects a date that matches the pattern but is not on the calendar", () => {
    // The regex alone accepted these. "2026-09-31" silently became October 1
    // in the database — a start date the student never chose — and month 13
    // produced an Invalid Date that surfaced as a 500 from the route.
    assert.equal(workProfileInputSchema.safeParse({ earliestStart: "2026-09-31" }).success, false);
    assert.equal(workProfileInputSchema.safeParse({ earliestStart: "2026-02-30" }).success, false);
    assert.equal(workProfileInputSchema.safeParse({ earliestStart: "2026-13-01" }).success, false);
    assert.equal(workProfileInputSchema.safeParse({ earliestStart: "2026-00-10" }).success, false);
    // A real leap day still passes.
    assert.equal(workProfileInputSchema.safeParse({ earliestStart: "2028-02-29" }).success, true);
  });

  it("allows every field to be cleared with null", () => {
    const parsed = workProfileInputSchema.parse({
      transport: null,
      payFloorHourly: null,
      earliestStart: null,
      childcareHours: null,
      homeZip: null,
      county: null,
      maxCommuteMinutes: null,
      shiftLimits: null,
    });
    assert.equal(parsed.transport, null);
    assert.equal(parsed.earliestStart, null);
  });
});
