import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { NextRequest } from "next/server";
import { mockStudentSession } from "@/lib/test-helpers";

const session = mockStudentSession({ id: "student-a", studentId: "student-a" });

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
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 500;
          return Response.json({ error: (err as Error).message }, { status });
        }
      },
    notFound: (message: string) => makeHttpError(404, message),
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/schemas", {
  namedExports: {
    parseBody: async (req: Request, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }) => {
      const raw = await req.json();
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw makeHttpError(400, "Invalid request body.");
      return parsed.data;
    },
  },
});

const dismissPanelMock = mock.fn(async () => true);
mock.module("@/lib/sage/panel-data", {
  namedExports: { dismissPanel: dismissPanelMock },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

function request(body: unknown): NextRequest {
  return new Request("http://localhost:3000/api/sage/panel/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/sage/panel/dismiss", () => {
  beforeEach(() => {
    dismissPanelMock.mock.resetCalls();
    dismissPanelMock.mock.mockImplementation(async () => true);
  });

  it("dismisses an owned panel", async () => {
    const res = await route.POST(request({ panelId: "cjld2cjxh0000qzrmn831i7rn" }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; data: { status: string } };
    assert.equal(body.data.status, "dismissed");
    const args = dismissPanelMock.mock.calls[0].arguments as unknown[];
    assert.equal((args[1] as { id: string }).id, "student-a");
  });

  it("404s when the caller has no claim to the panel (cross-student)", async () => {
    dismissPanelMock.mock.mockImplementation(async () => false);
    const res = await route.POST(request({ panelId: "cjld2cjxh0000qzrmn831i7rn" }));
    assert.equal(res.status, 404);
  });

  it("400s on a non-cuid panelId", async () => {
    const res = await route.POST(request({ panelId: "../../etc/passwd" }));
    assert.equal(res.status, 400);
    assert.equal(dismissPanelMock.mock.callCount(), 0);
  });
});
