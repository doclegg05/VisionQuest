/**
 * The webhook is the staff-authenticated door into the same provisioning
 * code. It may do things the public form may not — name a class, refresh an
 * existing record, and receive the one-time temporary password — but it is
 * still an API boundary, so a driver error must not travel back through it
 * (review finding M4).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

mock.module("@/lib/auth", { namedExports: { getSession: async () => null } });

class FakeApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

mock.module("@/lib/api-error", {
  namedExports: {
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    // parseBody reaches for this on a schema failure; without it the route
    // would 500 on a bad payload and the 400 case would pass for the wrong
    // reason.
    badRequest: (message: string) => new FakeApiError(400, message),
    // Faithful to the real wrapper's contract: ApiError renders as its own
    // status and message, anything else as a bare 500 with no detail.
    withErrorHandler:
      <Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(...args);
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (typeof status === "number") {
            return Response.json({ error: (err as Error).message }, { status });
          }
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
  },
});

const loggedErrors: Array<Record<string, unknown>> = [];
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: (_message: string, payload?: Record<string, unknown>) => {
        loggedErrors.push(payload ?? {});
      },
    },
  },
});

let provisionResult: unknown = null;
let provisionError: Error | null = null;
const provisionMock = mock.fn(async (_payload: unknown, _options: unknown) => {
  if (provisionError) throw provisionError;
  return provisionResult;
});

mock.module("@/lib/intake/provision", {
  namedExports: { provisionIntakeStudent: provisionMock },
});

let route: typeof import("./route");

before(async () => {
  process.env.INTAKE_WEBHOOK_SECRET = "test-webhook-secret";
  // The route must not fall back to this. CRON_SECRET authenticates every
  // /api/internal/* cron endpoint, so handing it to an external form vendor
  // would make one vendor-side leak reach the whole internal job surface.
  process.env.CRON_SECRET = "the-cron-secret-that-must-not-work-here";
  route = await import("./route");
});

// Consent is no longer defaulted anywhere: `intakePayloadSchema` requires both
// flags as `z.literal(true)`, and the webhook parses that same schema. A staff
// caller (or the Power Automate form behind it) is asserting that a signed
// consent exists on paper — an authenticated, audited assertion, unlike the
// anonymous one the public route used to accept. An integration that omits
// these now gets a 400 rather than an intake with no recorded consent.
const PAYLOAD = {
  firstName: "Dana",
  lastName: "Hall",
  birthDate: "1988-02-03",
  county: "Kanawha",
  ferpaConsentSigned: true as const,
  policyAcknowledgmentSigned: true as const,
};

function postWebhook(body: Record<string, unknown> = PAYLOAD): Request {
  return new Request("http://localhost:3000/api/intake/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-webhook-secret",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/intake/webhook", () => {
  beforeEach(() => {
    provisionError = null;
    provisionResult = {
      outcome: "provisioned",
      studentDbId: "stu_1",
      studentId: "dana.hall",
      displayName: "Dana Hall",
      spokesRecordId: "spokes_1",
      classId: "class_1",
      className: "Kanawha County SPOKES",
      orientationInitialized: true,
      temporaryPassword: "K7QM-2XPT-9RHF",
      pdfStorageKey: "packet.pdf",
    };
    provisionMock.mock.resetCalls();
    loggedErrors.length = 0;
    process.env.INTAKE_WEBHOOK_SECRET = "test-webhook-secret";
  });

  function postWithAuth(authorization: string | null): Request {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authorization) headers.authorization = authorization;
    return new Request("http://localhost:3000/api/intake/webhook", {
      method: "POST",
      headers,
      body: JSON.stringify(PAYLOAD),
    });
  }

  it("rejects an unauthenticated caller", async () => {
    const res = await route.POST(postWithAuth(null));

    assert.equal(res.status, 401);
    assert.equal(provisionMock.mock.callCount(), 0);
  });

  it("rejects a wrong secret", async () => {
    const res = await route.POST(postWithAuth("Bearer not-the-secret"));

    assert.equal(res.status, 401);
    assert.equal(provisionMock.mock.callCount(), 0);
  });

  it("does not accept CRON_SECRET, which authenticates the internal job surface", async () => {
    // With its own secret set, the fallback never fired anyway. The escalation
    // lived in the case that is production today: INTAKE_WEBHOOK_SECRET was
    // declared nowhere, so `|| CRON_SECRET` made the token that authenticates
    // every /api/internal/* cron endpoint the webhook's password, and one
    // vendor-side leak reached the whole internal job surface.
    delete process.env.INTAKE_WEBHOOK_SECRET;

    const res = await route.POST(postWithAuth(`Bearer ${process.env.CRON_SECRET}`));

    assert.equal(res.status, 401);
    assert.equal(provisionMock.mock.callCount(), 0);
  });

  it("refuses the webhook and raises an alert when its own secret is unset", async () => {
    delete process.env.INTAKE_WEBHOOK_SECRET;

    const res = await route.POST(postWithAuth("Bearer anything-at-all"));

    assert.equal(res.status, 401);
    assert.equal(provisionMock.mock.callCount(), 0);
    assert.ok(
      loggedErrors.some((entry) => entry.alert === "intake_webhook_secret_missing"),
      `a missing webhook secret must be loud, logged: ${JSON.stringify(loggedErrors)}`,
    );
  });

  it("rejects a payload missing required fields with 400, before provisioning", async () => {
    const res = await route.POST(
      new Request("http://localhost:3000/api/intake/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer test-webhook-secret",
        },
        body: JSON.stringify({ firstName: "Dana" }),
      }),
    );
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.ok(body.error);
    assert.equal(provisionMock.mock.callCount(), 0);
  });

  it("provisions as staff, not as the public form", async () => {
    await route.POST(postWebhook());

    const options = provisionMock.mock.calls[0]?.arguments[1] as { source?: string } | undefined;
    assert.equal(options?.source, "staff");
  });

  it("hands the one-time temporary password to the authenticated caller", async () => {
    const res = await route.POST(postWebhook());
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.credentials.temporaryPassword, "K7QM-2XPT-9RHF");
    assert.equal(body.credentials.mustChangePassword, true);
  });

  it("returns a generic message when provisioning throws, with no driver detail", async () => {
    provisionError = new Error(
      'Invalid `prisma.spokesRecord.create()` invocation: Foreign key constraint failed on the field: `studentId`',
    );

    const res = await route.POST(postWebhook());
    const body = await res.json();
    const raw = JSON.stringify(body);

    assert.equal(res.status, 500);
    assert.ok(!raw.includes("prisma"), `response leaked Prisma internals: ${raw}`);
    assert.ok(!raw.includes("Foreign key"), `response leaked the driver error: ${raw}`);
    assert.ok(!("message" in body), `response carried a raw message field: ${raw}`);
  });
});
