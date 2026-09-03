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

mock.module("@/lib/api-error", {
  namedExports: {
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
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

mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
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
  route = await import("./route");
});

const PAYLOAD = {
  firstName: "Dana",
  lastName: "Hall",
  birthDate: "1988-02-03",
  county: "Kanawha",
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
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await route.POST(
      new Request("http://localhost:3000/api/intake/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(PAYLOAD),
      }),
    );

    assert.equal(res.status, 401);
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
