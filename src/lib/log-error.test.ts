import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { errorForLog } from "./log-error";
import { logger } from "./logger";

const STUDENT_ID = "cm8studentid0000000000001";

// Prisma echoes the call's arguments into its messages, so a failed alert
// upsert quotes the alertKey, and the alertKey embeds the student id.
const ALERT_KEY = `evidence_gap:${STUDENT_ID}:req_orientation`;

describe("errorForLog", () => {
  it("keeps a Prisma known-request error's name and code, not its message", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the fields: (\`alertKey\`) where alertKey = ${ALERT_KEY}`,
      { code: "P2002", clientVersion: "test" },
    );

    assert.deepEqual(errorForLog(error), { name: "PrismaClientKnownRequestError", code: "P2002" });
  });

  it("keeps only the name of a Prisma validation error, which has no code", () => {
    const error = new Prisma.PrismaClientValidationError(
      `Invalid \`prisma.studentAlert.upsert()\` invocation:\n{ where: { alertKey: "${ALERT_KEY}" } }`,
      { clientVersion: "test" },
    );

    assert.deepEqual(errorForLog(error), { name: "PrismaClientValidationError" });
  });

  it("uses an initialization error's errorCode, so an unreachable database still reads P1001", () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Can't reach database server at db.example.internal:5432",
      "test",
      "P1001",
    );

    assert.deepEqual(errorForLog(error), { name: "PrismaClientInitializationError", code: "P1001" });
  });

  it("drops a code that is not code-shaped, since any library may put text there", () => {
    const error = Object.assign(new Error("boom"), { code: ALERT_KEY });

    assert.deepEqual(errorForLog(error), { name: "Error" });
  });

  it("drops codes shaped like a phone number or a login id", () => {
    for (const code of ["3045551234", "JSMITH01"]) {
      assert.deepEqual(errorForLog(Object.assign(new Error("boom"), { code })), { name: "Error" }, code);
    }
  });

  it("keeps Node error codes and Postgres SQLSTATEs", () => {
    for (const code of ["ECONNREFUSED", "ERR_INVALID_URL", "42501"]) {
      assert.deepEqual(errorForLog(Object.assign(new Error("boom"), { code })), { name: "Error", code }, code);
    }
  });

  it("falls back to Error when a custom name carries text", () => {
    const named = Object.assign(new Error("boom"), { name: `Student ${STUDENT_ID} failed` });
    const objectNamed = Object.assign(new Error("boom"), { name: { studentId: STUDENT_ID } });

    assert.deepEqual(errorForLog(named), { name: "Error" });
    assert.deepEqual(errorForLog(objectNamed), { name: "Error" });
  });

  it("follows the cause one level, so 'fetch failed' still says ECONNREFUSED", () => {
    const refused = Object.assign(new Error(`connect ECONNREFUSED for ${STUDENT_ID}`), { code: "ECONNREFUSED" });
    const deeper = new TypeError("fetch failed", { cause: new Error("outer", { cause: refused }) });

    assert.deepEqual(errorForLog(new TypeError("fetch failed", { cause: refused })), {
      name: "TypeError",
      cause: { name: "Error", code: "ECONNREFUSED" },
    });
    assert.deepEqual(errorForLog(deeper), { name: "TypeError", cause: { name: "Error" } });
  });

  it("names the type of a thrown non-Error and never echoes its value", () => {
    assert.deepEqual(errorForLog(`failed for ${STUDENT_ID}`), { name: "string" });
    assert.deepEqual(errorForLog({ studentId: STUDENT_ID }), { name: "object" });
    assert.deepEqual(errorForLog(null), { name: "null" });
  });
});

describe("errorForLog through the real logger", () => {
  let lines: string[] = [];

  beforeEach(() => {
    lines = [];
    mock.method(console, "error", (line: string) => lines.push(line));
  });

  afterEach(() => mock.restoreAll());

  it("writes a log line with the Prisma code and no trace of the student id", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed where alertKey = ${ALERT_KEY}`,
      { code: "P2002", clientVersion: "test" },
    );

    logger.error("Evidence gap detection failed", { error: errorForLog(error) });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /P2002/);
    assert.ok(!lines[0].includes(STUDENT_ID), `log line carries a raw student id: ${lines[0]}`);
  });
});
