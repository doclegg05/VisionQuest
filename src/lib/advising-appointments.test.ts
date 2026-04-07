import test from "node:test";
import assert from "node:assert/strict";
import { buildAppointmentEmailCopy } from "./advising-appointments";

test("buildAppointmentEmailCopy formats when, location, link, and notes", () => {
  const copy = buildAppointmentEmailCopy({
    title: "Career coaching",
    startsAt: new Date("2026-04-08T15:30:00.000Z"),
    locationType: "virtual",
    locationLabel: "Zoom room",
    meetingUrl: "https://example.com/meet",
    notes: "Bring your resume draft",
  });

  assert.equal(copy.where, "Zoom room");
  assert.match(copy.when, /Wed, Apr 8/i);
  assert.equal(copy.optionalLink, "\nJoin link: https://example.com/meet");
  assert.equal(copy.optionalNotes, "\nNotes: Bring your resume draft");
});

test("buildAppointmentEmailCopy falls back to normalized location type", () => {
  const copy = buildAppointmentEmailCopy({
    title: "Phone check-in",
    startsAt: new Date("2026-04-08T15:30:00.000Z"),
    locationType: "in_person",
    locationLabel: null,
    meetingUrl: null,
    notes: null,
  });

  assert.equal(copy.where, "in person");
  assert.equal(copy.optionalLink, "");
  assert.equal(copy.optionalNotes, "");
});
