import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fleschKincaidGrade, PLAIN_LANGUAGE_IDEAL_GRADE } from "./sage/readability";

// The words a student reads when a password change is refused.
//
// What the change does is tested through its route, with the real limiter and
// the sign-in route beside it (src/app/api/settings/password/route.test.ts).
// This file holds the copy to the reading level the students need: adults,
// many with low literacy, often on a phone.

process.env.JWT_SECRET ??= "test-secret-for-password-change-copy-suite";

const KINDS = [
  "wrong_current_password",
  "budget_spent",
  "limiter_unavailable",
  "no_password_set",
  "same_as_current",
  "contains_login",
  "changed_elsewhere",
] as const;

describe("password change refusals", async () => {
  const { passwordChangeRefusal } = await import("./password-change");
  const refusals = KINDS.map((kind) => ({ kind, ...passwordChangeRefusal({ kind }) }));

  it("gives every refusal its own code", () => {
    assert.equal(new Set(refusals.map((refusal) => refusal.code)).size, KINDS.length);
  });

  it("answers a spent budget with 429, a limiter outage with 503 and a lost race with 409", () => {
    const status = Object.fromEntries(refusals.map((refusal) => [refusal.kind, refusal.status]));
    assert.equal(status.budget_spent, 429);
    assert.equal(status.limiter_unavailable, 503);
    assert.equal(status.changed_elsewhere, 409);
    assert.equal(status.wrong_current_password, 400, "not 401: the student is signed in, and a client must not sign them out");
  });

  it("writes every message at a 6th-grade level, with no dash", () => {
    for (const { kind, error } of refusals) {
      assert.ok(fleschKincaidGrade(error) <= PLAIN_LANGUAGE_IDEAL_GRADE, `${kind}: grade ${fleschKincaidGrade(error).toFixed(1)}: ${error}`);
      assert.doesNotMatch(error, /[-‐-―]/u, kind);
    }
  });

  it("names the wait in minutes where there is one, and names no password", () => {
    assert.match(passwordChangeRefusal({ kind: "budget_spent" }).error, /15 minutes/u);
    assert.match(passwordChangeRefusal({ kind: "wrong_current_password" }).error, /15 minutes/u);
  });
});
