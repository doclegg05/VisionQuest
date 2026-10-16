import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { logger, requestId } from "./logger";

describe("requestId", () => {
  it("returns a non-empty string", () => {
    const id = requestId();
    assert.ok(typeof id === "string");
    assert.ok(id.length > 0);
  });

  it("returns unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => requestId()));
    assert.equal(ids.size, 100);
  });
});

// Compile-time only: tsc fails on an unused @ts-expect-error, so each call
// below must stay a type error. The ESLint key selectors see literal keys
// inside a logger call; a context object built elsewhere and spread in is
// invisible to them, and the type is what stops it.
export function _logContextTypeChecks(studentId: string, err: Error) {
  const withStudentId = { surface: "probe", studentId };
  // @ts-expect-error a context carrying a raw student id does not compile
  logger.warn("probe", { ...withStudentId });
  const withMessage = { message: err.name };
  // @ts-expect-error `message` is the entry's own field; a context key would overwrite it
  logger.error("probe", { ...withMessage });
}
