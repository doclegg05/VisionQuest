/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

const mockHasPermission = mock.fn() as any;
let currentSession: { id: string; role: string } = { id: "u1", role: "program_coordinator" };

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <A extends unknown[]>(handler: (s: typeof currentSession, ...a: A) => Promise<Response>) =>
      async (...args: A) => {
        try {
          return await handler(currentSession, ...args);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code) return Response.json({ error: (e as Error).message }, { status: code });
          throw e;
        }
      },
    forbidden: (m?: string) => httpError(403, m ?? "Forbidden"),
    unauthorized: (m?: string) => httpError(401, m ?? "Unauthorized"),
  },
});
mock.module("@/lib/rbac", { namedExports: { hasPermission: mockHasPermission } });

let withCoordinatorAuth: typeof import("./coordinator-auth").withCoordinatorAuth;
before(async () => {
  ({ withCoordinatorAuth } = await import("./coordinator-auth"));
});

describe("withCoordinatorAuth for program coordinators", () => {
  it("returns 403 on coordinator.grant.edit when RBAC denies it", async () => {
    currentSession = { id: "u1", role: "program_coordinator" };
    mockHasPermission.mock.mockImplementation(async (_r: string, key: string) => key !== "coordinator.grant.edit");
    const post = withCoordinatorAuth("coordinator.grant.edit", async () => Response.json({ ok: true }));
    assert.equal((await post()).status, 403);
    const get = withCoordinatorAuth("coordinator.grant.view", async () => Response.json({ ok: true }));
    assert.equal((await get()).status, 200);
  });
});
