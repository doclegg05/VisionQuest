import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEMO_ENTRY_FAILED } from "@/lib/demo/copy";
import { continueTargetFor, entryOutcomeFor } from "./demo-entry";

/** What GET /api/auth/session answers for a live session. */
function sessionBody(overrides: Record<string, unknown>) {
  return {
    student: {
      id: "cl0000000000000000000000",
      studentId: "demo-0123456789ab",
      displayName: "Maya R.",
      role: "student",
      ...overrides,
    },
  };
}

describe("continueTargetFor", () => {
  it("links a demo student back to the dashboard", () => {
    assert.deepEqual(continueTargetFor(sessionBody({ demoAccount: "student" })), {
      label: "Continue as Maya R.",
      href: "/dashboard",
    });
  });

  it("links the demo instructor back to the teacher home", () => {
    const body = sessionBody({
      studentId: "demo-instructor",
      displayName: "Demo Instructor",
      role: "teacher",
      demoAccount: "instructor",
    });
    assert.deepEqual(continueTargetFor(body), {
      label: "Continue as Demo Instructor",
      href: "/teacher",
    });
  });

  it("trims the name it shows", () => {
    const target = continueTargetFor(sessionBody({ displayName: "  Maya R.  ", demoAccount: "student" }));
    assert.equal(target?.label, "Continue as Maya R.");
  });

  it("returns null for a real student, who has no demoAccount", () => {
    assert.equal(continueTargetFor(sessionBody({})), null);
    assert.equal(continueTargetFor(sessionBody({ demoAccount: null })), null);
  });

  it("returns null for a real teacher", () => {
    assert.equal(continueTargetFor(sessionBody({ role: "teacher" })), null);
  });

  it("returns null for the 401 body of a visitor with no session", () => {
    assert.equal(continueTargetFor({ error: "Unauthorized" }), null);
  });

  it("returns null for garbage", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      "Continue as Maya",
      42,
      [],
      {},
      { student: null },
      { student: "Maya R." },
      sessionBody({ displayName: undefined, demoAccount: "student" }),
      sessionBody({ displayName: "", demoAccount: "student" }),
      sessionBody({ displayName: "   ", demoAccount: "student" }),
      sessionBody({ displayName: 7, demoAccount: "student" }),
      sessionBody({ demoAccount: "admin" }),
      sessionBody({ demoAccount: 1 }),
    ];
    for (const body of garbage) {
      assert.equal(continueTargetFor(body), null, `expected null for ${JSON.stringify(body)}`);
    }
  });
});

describe("entryOutcomeFor", () => {
  it("sends a student to the page the endpoint names", () => {
    const outcome = entryOutcomeFor(true, { redirectTo: "/dashboard", student: { displayName: "Maya R." } });
    assert.deepEqual(outcome, { kind: "enter", redirectTo: "/dashboard" });
  });

  it("sends the instructor to the page the endpoint names", () => {
    assert.deepEqual(entryOutcomeFor(true, { redirectTo: "/teacher" }), {
      kind: "enter",
      redirectTo: "/teacher",
    });
  });

  it("shows the endpoint's own message when it refuses", () => {
    const error = "The demo is full for today. Please try again tomorrow.";
    assert.deepEqual(entryOutcomeFor(false, { error }), { kind: "refused", message: error });
  });

  it("falls back to the retry message when a refusal has no usable error", () => {
    const refusedWithout: unknown[] = [null, undefined, "oops", 500, [], {}, { error: "" }, { error: "   " }, { error: 5 }];
    for (const body of refusedWithout) {
      assert.deepEqual(
        entryOutcomeFor(false, body),
        { kind: "refused", message: DEMO_ENTRY_FAILED },
        `expected the retry message for ${JSON.stringify(body)}`,
      );
    }
  });

  it("does not navigate on a success body that has no safe redirect", () => {
    const unsafe: unknown[] = [
      null,
      {},
      { redirectTo: "" },
      { redirectTo: 7 },
      { redirectTo: "dashboard" },
      { redirectTo: "//evil.example/dashboard" },
      { redirectTo: "/\\evil.example/dashboard" },
      { redirectTo: "https://evil.example/dashboard" },
      { redirectTo: "javascript:alert(1)" },
    ];
    for (const body of unsafe) {
      assert.deepEqual(
        entryOutcomeFor(true, body),
        { kind: "refused", message: DEMO_ENTRY_FAILED },
        `expected no navigation for ${JSON.stringify(body)}`,
      );
    }
  });
});
