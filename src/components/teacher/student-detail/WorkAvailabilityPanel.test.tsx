import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { WorkAvailabilityPanel } from "./WorkAvailabilityPanel";

/**
 * The instructor's read-only view of a student's work profile (Match &
 * Connect Task 2.2). It has to read cleanly at every stage of filling in —
 * nothing answered, some answered, all answered — because a half-filled
 * profile is the normal case, not an edge case.
 */

const emptyGrid = {
  monday: { morning: false, afternoon: false, evening: false, overnight: false },
  tuesday: { morning: false, afternoon: false, evening: false, overnight: false },
  wednesday: { morning: false, afternoon: false, evening: false, overnight: false },
  thursday: { morning: false, afternoon: false, evening: false, overnight: false },
  friday: { morning: false, afternoon: false, evening: false, overnight: false },
  saturday: { morning: false, afternoon: false, evening: false, overnight: false },
  sunday: { morning: false, afternoon: false, evening: false, overnight: false },
};

describe("WorkAvailabilityPanel", () => {
  it("renders 'Not set yet' when the student has no work profile", () => {
    const html = renderToString(<WorkAvailabilityPanel workProfile={null} />);
    assert.ok(html.includes("Work availability"));
    assert.ok(html.includes("Not set yet"));
  });

  it("says 'Not set yet' per field rather than inventing a blank answer", () => {
    const html = renderToString(
      <WorkAvailabilityPanel
        workProfile={{
          studentId: "stu-1",
          availability: emptyGrid,
          transport: null,
          homeZip: null,
          county: null,
          maxCommuteMinutes: null,
          payFloorHourly: null,
          childcareHours: null,
          earliestStart: null,
          shiftLimits: null,
          updatedAt: "2026-09-05T00:00:00.000Z",
          updatedVia: "student",
        }}
      />,
    );
    // A row exists per question, and each unanswered one reads "Not set yet"
    // instead of "$0/hr" or an empty cell.
    assert.ok(html.includes("How they get to work"));
    assert.ok(html.includes("Not set yet"));
    assert.ok(!html.includes("$0"));
  });

  it("shows the answers the student gave, and who last wrote them", () => {
    const html = renderToString(
      <WorkAvailabilityPanel
        workProfile={{
          studentId: "stu-1",
          availability: {
            ...emptyGrid,
            monday: { morning: true, afternoon: true, evening: false, overnight: false },
          },
          transport: "bus",
          homeZip: "25301",
          county: "Kanawha",
          maxCommuteMinutes: 30,
          payFloorHourly: 15,
          childcareHours: { note: "Kids are at school 8 to 3." },
          earliestStart: "2026-10-01",
          shiftLimits: null,
          updatedAt: "2026-09-05T00:00:00.000Z",
          updatedVia: "sage",
        }}
      />,
    );
    assert.ok(html.includes("Bus"));
    assert.ok(html.includes("15"));
    assert.ok(html.includes("Kids are at school 8 to 3."));
    assert.ok(html.includes("2026-10-01"));
    // Monday morning and afternoon are the only marked cells.
    assert.ok(html.includes("Monday"));
    assert.ok(html.includes("Sage"));
  });
});
