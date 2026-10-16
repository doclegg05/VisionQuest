import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";

let POST: (req: Request) => Promise<Response>;

const RESOLVED = {
  resolved: 3,
  won: 2,
  lost: 1,
  voided: 0,
  diagnosable: ["w-loss"],
};
let resolveDueWagers: () => Promise<typeof RESOLVED> = async () => RESOLVED;

mock.module("@/lib/sage/wagers", {
  namedExports: { resolveDueWagers: () => resolveDueWagers() },
});
mock.module("@/lib/jobs", {
  namedExports: { enqueueJob: async () => "job-1" },
});

before(async () => {
  process.env.CRON_SECRET = "test-secret";
  process.env.SAGE_WAGER_DIAGNOSIS_ENABLED = "";
  ({ POST } = await import("./route"));
});

afterEach(() => {
  resolveDueWagers = async () => RESOLVED;
  mock.restoreAll();
});

function authorizedRequest(): Request {
  return new Request("http://x/api/internal/wagers/resolve", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

describe("POST /api/internal/wagers/resolve", () => {
  it("401s without the bearer secret", async () => {
    const res = await POST(new Request("http://x/api/internal/wagers/resolve", { method: "POST" }));
    assert.equal(res.status, 401);
  });

  it("resolves due wagers with a valid secret", async () => {
    const res = await POST(authorizedRequest());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resolved, 3);
    assert.equal(body.won, 2);
  });

  it("logs a failed run by error name and Prisma code, never the message text", async () => {
    const studentId = "cm8wagerstudent0000000001";
    resolveDueWagers = async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        `Record to update not found. where: { studentId: "${studentId}" }`,
        { code: "P2025", clientVersion: "test" },
      );
    };
    const lines: string[] = [];
    mock.method(console, "error", (line: string) => lines.push(line));

    const res = await POST(authorizedRequest());

    assert.equal(res.status, 500);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /P2025/);
    assert.ok(!lines[0].includes(studentId), `log line carries a raw student id: ${lines[0]}`);
  });
});
