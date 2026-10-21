/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is intentionally loose across the shared prisma + email mocks. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock, test } from "node:test";

// advising-appointments talks to Postgres through prismaAdmin and sends mail
// through ./email, which it imports lazily. Both are swapped here, and the
// module is imported only after the mocks are registered.

type Person = { displayName: string; email: string | null; demoAccount: string | null };
type AppointmentRow = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  locationType: string;
  locationLabel: string | null;
  meetingUrl: string | null;
  notes: string | null;
  student: Person;
  advisor: Person;
};

const REAL_STUDENT: Person = { displayName: "Jane Doe", email: "jane@example.test", demoAccount: null };
const REAL_ADVISOR: Person = { displayName: "Ms. Legg", email: "legg@example.test", demoAccount: null };
const DEMO_STUDENT: Person = { displayName: "Demo Student", email: null, demoAccount: "student" };
const DEMO_ADVISOR: Person = { displayName: "Demo Instructor", email: null, demoAccount: "instructor" };

const NOW = new Date("2026-10-19T15:00:00.000Z");

function appointment(id: string, student: Person, advisor: Person): AppointmentRow {
  return {
    id,
    title: "Career coaching",
    description: null,
    startsAt: new Date("2026-10-20T15:00:00.000Z"),
    endsAt: new Date("2026-10-20T15:30:00.000Z"),
    locationType: "virtual",
    locationLabel: "Zoom room",
    meetingUrl: null,
    notes: null,
    student,
    advisor,
  };
}

const state = {
  appointments: [] as AppointmentRow[],
  emailConfigured: true,
};

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

const mockFindUnique = mock.fn(async (args: any) =>
  state.appointments.find((row) => row.id === args.where.id) ?? null,
) as any;
const mockUpdate = mock.fn(async () => ({})) as any;
// Evaluates the one kind of filter this suite cares about, the same way
// Postgres would: `student: { demoAccount: null }` keeps only rows whose
// student carries no demo marker. A sweep that forgets the filter returns the
// demo row and the test sees the email go out.
const mockFindMany = mock.fn(async (args: any) =>
  state.appointments.filter((row) => {
    const where = args.where ?? {};
    for (const relation of ["student", "advisor"] as const) {
      const wanted = where[relation];
      if (wanted && "demoAccount" in wanted && row[relation].demoAccount !== wanted.demoAccount) {
        return false;
      }
    }
    return true;
  }),
) as any;

mock.module("./db", {
  exports: {
    prismaAdmin: {
      appointment: { findUnique: mockFindUnique, findMany: mockFindMany, update: mockUpdate },
    },
  },
});

mock.module("./email", {
  exports: {
    isEmailDeliveryConfigured: () => state.emailConfigured,
    sendEmail: async (payload: { to: string; subject: string; text: string }) => {
      sentEmails.push(payload);
    },
  },
});

type Module = typeof import("./advising-appointments");
let buildAppointmentEmailCopy: Module["buildAppointmentEmailCopy"];
let sendAppointmentConfirmation: Module["sendAppointmentConfirmation"];
let sendPendingAppointmentReminders: Module["sendPendingAppointmentReminders"];

before(async () => {
  ({ buildAppointmentEmailCopy, sendAppointmentConfirmation, sendPendingAppointmentReminders } =
    await import("./advising-appointments"));
});

beforeEach(() => {
  state.appointments = [];
  state.emailConfigured = true;
  sentEmails.length = 0;
  mockFindUnique.mock.resetCalls();
  mockFindMany.mock.resetCalls();
  mockUpdate.mock.resetCalls();
});

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

describe("sendAppointmentConfirmation and demo accounts", () => {
  it("skips confirmation when the student or advisor is a demo account", async () => {
    const cases: Array<[string, Person, Person]> = [
      ["a demo student", DEMO_STUDENT, DEMO_ADVISOR],
      ["a demo student with a real advisor", DEMO_STUDENT, REAL_ADVISOR],
      ["a real student with the demo instructor", REAL_STUDENT, DEMO_ADVISOR],
    ];

    for (const [label, student, advisor] of cases) {
      state.appointments = [appointment("appt-1", student, advisor)];
      sentEmails.length = 0;
      mockUpdate.mock.resetCalls();

      const result = await sendAppointmentConfirmation("appt-1");

      assert.deepEqual(result, { sent: false, reason: "demo" }, label);
      assert.equal(sentEmails.length, 0, `${label}: nothing is emailed`);
      assert.equal(mockUpdate.mock.callCount(), 0, `${label}: confirmationSentAt is not stamped`);
    }
  });

  it("reads the demo marker for both people on the appointment", async () => {
    state.appointments = [appointment("appt-1", REAL_STUDENT, REAL_ADVISOR)];

    await sendAppointmentConfirmation("appt-1");

    const select = mockFindUnique.mock.calls[0].arguments[0].select;
    assert.equal(select.student.select.demoAccount, true);
    assert.equal(select.advisor.select.demoAccount, true);
  });

  it("still confirms an appointment between real people", async () => {
    state.appointments = [appointment("appt-1", REAL_STUDENT, REAL_ADVISOR)];

    const result = await sendAppointmentConfirmation("appt-1");

    assert.deepEqual(result, { sent: true, recipientCount: 2 });
    assert.deepEqual(sentEmails.map((email) => email.to).sort(), [
      "jane@example.test",
      "legg@example.test",
    ]);
    assert.equal(mockUpdate.mock.callCount(), 1);
  });
});

describe("sendPendingAppointmentReminders and demo accounts", () => {
  it("leaves demo appointments out of the reminder sweep", async () => {
    state.appointments = [
      appointment("appt-demo", DEMO_STUDENT, DEMO_ADVISOR),
      appointment("appt-demo-student", DEMO_STUDENT, REAL_ADVISOR),
      appointment("appt-demo-advisor", REAL_STUDENT, DEMO_ADVISOR),
      appointment("appt-real", REAL_STUDENT, REAL_ADVISOR),
    ];

    const result = await sendPendingAppointmentReminders({ now: NOW });

    assert.deepEqual(result, { sent: 1, skipped: 0 });
    assert.deepEqual(sentEmails.map((email) => email.to).sort(), [
      "jane@example.test",
      "legg@example.test",
    ]);
    assert.deepEqual(
      mockUpdate.mock.calls.map((call: any) => call.arguments[0].where.id),
      ["appt-real"],
      "only the real appointment is stamped as reminded",
    );
  });

  it("filters on both people in the query itself", async () => {
    await sendPendingAppointmentReminders({ now: NOW });

    const where = mockFindMany.mock.calls[0].arguments[0].where;
    assert.deepEqual(where.student, { demoAccount: null });
    assert.deepEqual(where.advisor, { demoAccount: null });
    assert.equal(where.status, "scheduled", "the existing filters stay");
    assert.equal(where.reminderSentAt, null);
  });
});
