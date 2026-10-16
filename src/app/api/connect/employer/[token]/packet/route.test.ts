import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";

/**
 * This route has no handler-level catch, so an unexpected failure reaches
 * withErrorHandler (src/lib/api-error.ts), the catch-all every wrapped route
 * in the app shares. Its log line must not carry the Prisma message, which
 * quotes the failed call's arguments.
 */
let GET: (req: Request, context: { params: Promise<{ token: string }> }) => Promise<Response>;

let resolvePacketFile: () => Promise<unknown> = async () => null;

mock.module("@/lib/connect/employer-link", {
  namedExports: {
    EMPLOYER_LINK_INACTIVE_MESSAGE: "This link is no longer active.",
    resolvePacketFile: () => resolvePacketFile(),
  },
});
mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: async () => "all" },
});
mock.module("@/lib/storage", {
  namedExports: {
    downloadFile: async () => null,
    getPresignedDownloadUrl: async () => null,
  },
});

before(async () => {
  ({ GET } = await import("./route"));
});

afterEach(() => {
  resolvePacketFile = async () => null;
  mock.restoreAll();
});

function packetRequest() {
  return GET(new Request("http://x/api/connect/employer/tok/packet"), {
    params: Promise.resolve({ token: "tok" }),
  });
}

describe("GET /api/connect/employer/[token]/packet", () => {
  it("404s a link that resolves to nothing", async () => {
    const res = await packetRequest();
    assert.equal(res.status, 404);
  });

  it("logs an unhandled Prisma error by name and code, never the message text", async () => {
    const studentId = "cm8packetstudent000000001";
    resolvePacketFile = async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        `Invalid \`prisma.fileUpload.findFirst()\` invocation: where: { studentId: "${studentId}" }`,
        { code: "P2022", clientVersion: "test" },
      );
    };
    const lines: string[] = [];
    mock.method(console, "error", (line: string) => lines.push(line));

    const res = await packetRequest();

    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Internal server error", code: "INTERNAL_ERROR" });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /PrismaClientKnownRequestError/);
    assert.match(lines[0], /P2022/);
    assert.ok(!lines[0].includes(studentId), `log line carries a raw student id: ${lines[0]}`);
  });
});
