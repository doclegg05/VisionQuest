/**
 * The public intake endpoint is unauthenticated and account-creating, so the
 * assertions here are about what it must NEVER do: issue a session, hand back
 * a credential, or tell an anonymous caller whether the person they described
 * already has an account (review findings B1, B2, M4, M16, M17).
 *
 * These cases run the REAL `provisionIntakeStudent` over a faked Prisma client
 * rather than a mocked provisioner: the takeover this file exists to prevent
 * was a collaboration between the lookup in provision.ts and the cookie call in
 * the route, and a mocked provisioner cannot show that seam.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const setSessionCookieMock = mock.fn(async () => undefined);

mock.module("@/lib/auth", {
  namedExports: {
    setSessionCookie: setSessionCookieMock,
    hashPassword: (password: string) => ({ hash: `hashed:${password}`, salt: "salt" }),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    normalizeStudentId: (raw: string) => raw.trim().toLowerCase(),
  },
});

const rateLimitMock = mock.fn(async (_key: string, _limit: number, _windowMs: number) => ({
  success: true,
  remaining: 10,
  resetTime: Date.now() + 60_000,
  degraded: false,
}));

mock.module("@/lib/rate-limit", { namedExports: { rateLimit: rateLimitMock } });

mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

const tryLogAuditEventMock = mock.fn(async () => ({ audited: true }));
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: tryLogAuditEventMock } });

const saveStampedIntakePacketMock = mock.fn(async () => ({ storageKey: "intake/packet.pdf" }));
mock.module("@/lib/intake/pdf-stamped-packet", {
  namedExports: { saveStampedIntakePacket: saveStampedIntakePacketMock },
});

/** The account an anonymous caller must never be able to reach. */
const VICTIM = {
  id: "stu_victim_db_id",
  studentId: "jordan.reed",
  displayName: "Jordan Reed",
};

interface DbState {
  emailMatch: typeof VICTIM | null;
  spokesMatch: typeof VICTIM | null;
  activeClasses: Array<{ id: string; name: string; description: string | null }>;
  countyFilter: string | null;
}

const state: DbState = {
  emailMatch: null,
  spokesMatch: null,
  activeClasses: [],
  countyFilter: null,
};

const createdStudents: Array<Record<string, unknown>> = [];
const createdAlerts: Array<Record<string, unknown>> = [];
const createdEnrollments: Array<Record<string, unknown>> = [];
const spokesUpserts: Array<Record<string, unknown>> = [];

function classMatchesCounty(
  cls: { name: string; description: string | null },
  county: string,
): boolean {
  const haystack = `${cls.name} ${cls.description ?? ""}`.toLowerCase();
  return haystack.includes(county.toLowerCase());
}

const fakeClient = {
  student: {
    findFirst: async () => state.emailMatch,
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const created = { id: `stu_new_${createdStudents.length}`, ...data };
      createdStudents.push(created);
      return created;
    },
  },
  spokesRecord: {
    findFirst: async () => (state.spokesMatch ? { student: state.spokesMatch } : null),
    upsert: async ({ create, update }: { create: unknown; update: unknown }) => {
      spokesUpserts.push({ create, update } as Record<string, unknown>);
      return { id: "spokes_1" };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "spokes_1", ...data }),
  },
  spokesClass: {
    findFirst: async (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (typeof where.id === "string") {
        return state.activeClasses.find((c) => c.id === where.id) ?? null;
      }
      if (state.countyFilter) {
        return (
          state.activeClasses.find((c) => classMatchesCounty(c, state.countyFilter as string)) ??
          null
        );
      }
      return state.activeClasses[0] ?? null;
    },
  },
  studentClassEnrollment: {
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createdEnrollments.push(data);
      return data;
    },
  },
  studentAlert: {
    upsert: async ({ create }: { create: Record<string, unknown> }) => {
      createdAlerts.push(create);
      return create;
    },
  },
  orientationItem: {
    findMany: async () => [
      { id: "item_ferpa", label: "FERPA consent form", description: "Sign the release" },
      { id: "item_video", label: "Watch the welcome video", description: null },
    ],
  },
  orientationProgress: {
    createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }),
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeClient),
};

mock.module("@/lib/db", {
  namedExports: { prisma: fakeClient, prismaAdmin: fakeClient },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

const BASE_PAYLOAD = {
  firstName: "Jordan",
  lastName: "Reed",
  birthDate: "1991-04-12",
  county: "Kanawha",
  phone: "304-555-0100",
  signatureName: "Jordan Reed",
  ferpaConsentSigned: true,
  policyAcknowledgmentSigned: true,
};

function postIntake(payload: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/intake/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(payload),
  });
}

/** Every string value anywhere in the JSON body, for leak assertions. */
function flattenStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => flattenStrings(v, acc));
  else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((v) => flattenStrings(v, acc));
  }
  return acc;
}

function resetState() {
  state.emailMatch = null;
  state.spokesMatch = null;
  state.activeClasses = [
    { id: "class_kanawha", name: "Kanawha County SPOKES", description: null },
    { id: "class_mercer", name: "Mercer County SPOKES", description: null },
  ];
  state.countyFilter = null;
  createdStudents.length = 0;
  createdAlerts.length = 0;
  createdEnrollments.length = 0;
  spokesUpserts.length = 0;
  setSessionCookieMock.mock.resetCalls();
  rateLimitMock.mock.resetCalls();
  tryLogAuditEventMock.mock.resetCalls();
}

describe("POST /api/intake/submit — an anonymous caller is never authenticated", () => {
  beforeEach(resetState);

  it("issues no session for a brand-new enrollment", async () => {
    const res = await route.POST(postIntake(BASE_PAYLOAD) as never);

    assert.equal(res.status, 201);
    assert.equal(
      setSessionCookieMock.mock.callCount(),
      0,
      "the public intake endpoint must never mint a session",
    );
  });

  it("issues no session and returns no account detail when the name and birth date match an existing student", async () => {
    state.spokesMatch = VICTIM;
    state.countyFilter = "Kanawha";

    const res = await route.POST(postIntake(BASE_PAYLOAD) as never);
    const body = await res.json();
    const strings = flattenStrings(body);

    assert.equal(
      setSessionCookieMock.mock.callCount(),
      0,
      "a name + birth-date match must not log the caller in as that student",
    );
    assert.ok(
      !strings.includes(VICTIM.id),
      `response leaked the matched account id: ${JSON.stringify(body)}`,
    );
    assert.ok(
      !strings.includes(VICTIM.studentId),
      `response leaked the matched account username: ${JSON.stringify(body)}`,
    );
    assert.ok(
      !strings.includes(VICTIM.displayName),
      `response leaked the matched account display name: ${JSON.stringify(body)}`,
    );
  });

  it("issues no session and returns no account detail when the email matches an existing student", async () => {
    state.emailMatch = VICTIM;
    state.countyFilter = "Kanawha";

    const res = await route.POST(
      postIntake({ ...BASE_PAYLOAD, email: "Jordan.Reed@example.org" }) as never,
    );
    const body = await res.json();
    const strings = flattenStrings(body);

    assert.equal(setSessionCookieMock.mock.callCount(), 0);
    assert.ok(!strings.includes(VICTIM.id));
    assert.ok(!strings.includes(VICTIM.studentId));
  });

  it("answers a matched submission exactly as it answers a new one, so the endpoint is no enrollment oracle", async () => {
    state.countyFilter = "Kanawha";
    const newRes = await route.POST(postIntake(BASE_PAYLOAD) as never);
    const newBody = await newRes.json();

    resetState();
    state.spokesMatch = VICTIM;
    state.countyFilter = "Kanawha";
    const matchedRes = await route.POST(postIntake(BASE_PAYLOAD) as never);
    const matchedBody = await matchedRes.json();

    assert.equal(matchedRes.status, newRes.status);
    assert.deepEqual(matchedBody, newBody);
  });

  it("never overwrites an existing student's record from an anonymous request", async () => {
    state.spokesMatch = VICTIM;

    await route.POST(
      postIntake({
        ...BASE_PAYLOAD,
        county: "Mercer",
        householdType: "Two parent (2P)",
        educationalLevel: "Some college",
        notes: "attacker-supplied note",
      }) as never,
    );

    assert.equal(spokesUpserts.length, 0, "an anonymous caller must not write to a matched record");
    assert.equal(createdEnrollments.length, 0, "an anonymous caller must not move a matched student");
  });

  it("records a staff-visible duplicate signal so a real returning student is not silently dropped", async () => {
    state.spokesMatch = VICTIM;

    await route.POST(postIntake(BASE_PAYLOAD) as never);

    assert.equal(createdAlerts.length, 1);
    assert.equal(createdAlerts[0].studentId, VICTIM.id);
    assert.equal(createdAlerts[0].type, "duplicate_intake_submission");
  });
});

describe("POST /api/intake/submit — no credential ever reaches the caller", () => {
  beforeEach(resetState);

  it("returns no password, temporary or otherwise", async () => {
    const res = await route.POST(postIntake(BASE_PAYLOAD) as never);
    const body = await res.json();
    const raw = JSON.stringify(body);

    assert.ok(!("credentials" in body), `response carried a credentials block: ${raw}`);
    assert.ok(!/password/i.test(raw), `response mentioned a password: ${raw}`);
    assert.ok(!/Spokes20\d\d!/.test(raw), `response carried the shared temporary password: ${raw}`);
  });

  it("does not store the shared, guessable password on the new account", async () => {
    await route.POST(postIntake(BASE_PAYLOAD) as never);

    assert.equal(createdStudents.length, 1);
    const hash = createdStudents[0].passwordHash;
    assert.ok(
      hash === null || !/Spokes20\d\d!/.test(String(hash)),
      "the account was created with the shared temporary password",
    );
  });

  it("flags the new account for password rotation", async () => {
    await route.POST(postIntake(BASE_PAYLOAD) as never);

    assert.equal(createdStudents[0].mustChangePassword, true);
  });
});

describe("POST /api/intake/submit — caller-supplied class and error text", () => {
  beforeEach(resetState);

  it("ignores a caller-supplied classId so an anonymous caller cannot pick whose instructors see them", async () => {
    state.countyFilter = "Kanawha";

    await route.POST(postIntake({ ...BASE_PAYLOAD, classId: "class_mercer" }) as never);

    assert.equal(createdEnrollments.length, 1);
    assert.equal(
      createdEnrollments[0].classId,
      "class_kanawha",
      "the county match must win over the caller's classId",
    );
  });

  it("leaves the student unenrolled rather than dropping them in an arbitrary cohort", async () => {
    state.activeClasses = [{ id: "class_mercer", name: "Mercer County SPOKES", description: null }];
    state.countyFilter = "Kanawha";

    const res = await route.POST(postIntake(BASE_PAYLOAD) as never);

    assert.equal(res.status, 201);
    assert.equal(createdEnrollments.length, 0, "no county match must mean no enrollment");
  });

  // Carried over from the route's original suite, which this file replaced.
  it("rejects an incomplete payload with 400 and provisions nothing", async () => {
    const res = await route.POST(postIntake({ firstName: "Jordan" }) as never);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.ok(body.error);
    assert.equal(createdStudents.length, 0);
  });

  it("refuses and provisions nothing once the per-network limit is spent", async () => {
    rateLimitMock.mock.mockImplementationOnce(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      degraded: false,
    }));

    const res = await route.POST(postIntake(BASE_PAYLOAD) as never);

    assert.equal(res.status, 429);
    assert.equal(createdStudents.length, 0);
  });

  it("returns a generic message when provisioning throws, with no internal detail", async () => {
    const boom = new Error(
      'Invalid `prisma.student.create()` invocation: Unique constraint failed on the fields: (`email`)',
    );
    const original = fakeClient.student.create;
    fakeClient.student.create = async () => {
      throw boom;
    };

    try {
      const res = await route.POST(postIntake(BASE_PAYLOAD) as never);
      const body = await res.json();
      const raw = JSON.stringify(body);

      assert.equal(res.status, 500);
      assert.ok(!raw.includes("prisma"), `response leaked Prisma internals: ${raw}`);
      assert.ok(!raw.includes("Unique constraint"), `response leaked the driver error: ${raw}`);
      assert.ok(!("message" in body), `response carried a raw message field: ${raw}`);
    } finally {
      fakeClient.student.create = original;
    }
  });

  it("keys the applicant bucket on the calendar day, so re-spelling the date buys no new attempts", async () => {
    await route.POST(postIntake(BASE_PAYLOAD) as never);
    const isoKey = rateLimitMock.mock.calls
      .map((c) => String(c.arguments[0]))
      .find((k) => k.startsWith("intake:submit:person:"));

    resetState();
    await route.POST(postIntake({ ...BASE_PAYLOAD, birthDate: "April 12, 1991" }) as never);
    const prosePayload = rateLimitMock.mock.calls
      .map((c) => String(c.arguments[0]))
      .find((k) => k.startsWith("intake:submit:person:"));

    assert.equal(prosePayload, isoKey);
  });

  it("bounds submissions per applicant identity, not only per network address", async () => {
    await route.POST(postIntake(BASE_PAYLOAD) as never);

    const keys = rateLimitMock.mock.calls.map((c) => String(c.arguments[0]));
    assert.ok(
      keys.some((k) => k.startsWith("intake:submit:ip:")),
      `expected a per-network limit, got ${JSON.stringify(keys)}`,
    );
    assert.ok(
      keys.some((k) => k.startsWith("intake:submit:person:")),
      `expected a per-applicant limit, got ${JSON.stringify(keys)}`,
    );
  });
});
