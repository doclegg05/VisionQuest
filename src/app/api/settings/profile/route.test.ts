import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockRequest } from "@/lib/test-helpers";

// Adversarial coverage for the extended student self-service profile route:
// wrong-student payloads, oversized values, invalid enum options, and
// attempts to reach teacher-only SpokesRecord columns.

const session = mockStudentSession();

const mockSpokesFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockSpokesUpsert = mock.fn<(args: {
  where: { studentId: string };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}) => Promise<unknown>>();
const mockStudentFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      spokesRecord: {
        findUnique: mockSpokesFindUnique,
        upsert: mockSpokesUpsert,
      },
      student: {
        findUnique: mockStudentFindUnique,
      },
    },
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

function profileRequest(body: unknown): Request {
  return mockRequest("/api/settings/profile", { method: "POST", body }) as never;
}

describe("POST /api/settings/profile (in-browser Student Profile)", () => {
  beforeEach(() => {
    mockSpokesFindUnique.mock.resetCalls();
    mockSpokesUpsert.mock.resetCalls();
    mockStudentFindUnique.mock.resetCalls();

    mockSpokesFindUnique.mock.mockImplementation(async () => null);
    mockSpokesUpsert.mock.mockImplementation(async () => ({ birthDate: null }));
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      displayName: "Test Student",
      email: null,
    }));
  });

  it("maps a valid submission onto the student's own SpokesRecord", async () => {
    const res = await route.POST(
      profileRequest({
        profile: {
          first_name: "Evie",
          last_name: "Testerson",
          birth_date: "1990-01-02",
          county: "Kanawha",
          educational_level: "High school diploma",
        },
      }),
    );

    assert.equal(res.status, 200);
    assert.equal(mockSpokesUpsert.mock.callCount(), 1);
    const call = mockSpokesUpsert.mock.calls[0].arguments[0];
    assert.equal(call.where.studentId, session.id);
    assert.equal(call.update.firstName, "Evie");
    assert.equal(call.update.lastName, "Testerson");
    assert.equal(call.update.county, "Kanawha");
    assert.equal(call.update.educationalLevel, "High school diploma");
    assert.ok(call.update.birthDate instanceof Date);
    assert.equal((call.update.birthDate as Date).toISOString().slice(0, 10), "1990-01-02");
  });

  it("always writes session.id — a smuggled studentId never changes the target", async () => {
    const res = await route.POST(
      profileRequest({
        studentId: "someone-elses-cuid-000000000",
        profile: { first_name: "Mallory", last_name: "Attacker", birth_date: "1990-01-02", county: "Kanawha" },
      }),
    );

    assert.equal(res.status, 200);
    const call = mockSpokesUpsert.mock.calls[0].arguments[0];
    assert.equal(call.where.studentId, session.id);
    assert.equal(call.create.studentId, session.id);
  });

  it("rejects an invalid enum option with a 400", async () => {
    const res = await route.POST(
      profileRequest({
        profile: { first_name: "Evie", last_name: "T", birth_date: "1990-01-02", county: "Fakeshire" },
      }),
    );

    assert.equal(res.status, 400);
    assert.equal(mockSpokesUpsert.mock.callCount(), 0);
  });

  it("rejects an oversized field value with a 400", async () => {
    const res = await route.POST(
      profileRequest({
        profile: {
          first_name: "x".repeat(5000),
          last_name: "T",
          birth_date: "1990-01-02",
          county: "Kanawha",
        },
      }),
    );

    assert.equal(res.status, 400);
    assert.equal(mockSpokesUpsert.mock.callCount(), 0);
  });

  it("silently drops answer keys that try to reach teacher-only columns", async () => {
    const res = await route.POST(
      profileRequest({
        profile: {
          first_name: "Evie",
          last_name: "T",
          birth_date: "1990-01-02",
          county: "Kanawha",
          // Not in STUDENT_PROFILE_FIELDS — must never reach the record.
          status: "completed",
          hourlyWage: "99",
          requiredParticipationHours: "0",
        },
      }),
    );

    assert.equal(res.status, 200);
    const call = mockSpokesUpsert.mock.calls[0].arguments[0];
    assert.equal(call.update.status, undefined);
    assert.equal(call.update.hourlyWage, undefined);
    assert.equal(call.update.requiredParticipationHours, undefined);
    assert.equal(call.create.status, "referred");
  });

  it("rejects a future birth date with a 400", async () => {
    const res = await route.POST(
      profileRequest({
        profile: { first_name: "Evie", last_name: "T", birth_date: "2093-01-01", county: "Kanawha" },
      }),
    );

    assert.equal(res.status, 400);
    assert.equal(mockSpokesUpsert.mock.callCount(), 0);
  });

  it("rejects a malformed email with a 400", async () => {
    const res = await route.POST(
      profileRequest({
        profile: {
          first_name: "Evie",
          last_name: "T",
          birth_date: "1990-01-02",
          county: "Kanawha",
          contact_email: "not-an-email",
        },
      }),
    );

    assert.equal(res.status, 400);
    assert.equal(mockSpokesUpsert.mock.callCount(), 0);
  });

  it("keeps the legacy birthDate-only prompt working", async () => {
    const res = await route.POST(profileRequest({ birthDate: "1985-05-05" }));

    assert.equal(res.status, 200);
    const call = mockSpokesUpsert.mock.calls[0].arguments[0];
    assert.ok(call.update.birthDate instanceof Date);
    assert.equal(call.update.firstName, undefined);
  });
});

describe("GET /api/settings/profile", () => {
  it("returns stored values as prefill answers", async () => {
    mockSpokesFindUnique.mock.mockImplementation(async () => ({
      birthDate: new Date("1990-01-02T00:00:00Z"),
      firstName: "Evie",
      lastName: "Testerson",
      county: "Kanawha",
      householdType: null,
      gender: null,
      race: null,
      ethnicity: null,
      educationalLevel: "High school diploma",
      referralEmail: null,
    }));

    const res = await route.GET();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.birthDate, "1990-01-02");
    assert.equal(body.profile.first_name, "Evie");
    assert.equal(body.profile.county, "Kanawha");
    assert.equal(body.profile.birth_date, "1990-01-02");
    assert.equal(body.profile.educational_level, "High school diploma");
  });
});
