import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fleschKincaidGrade, PLAIN_LANGUAGE_MAX_GRADE } from "@/lib/sage/readability";
import { resolveStaffRegistrationOutcome } from "./staff-registration-outcome";

// What the staff registration page does after a 2xx from
// /api/auth/register-teacher. A promotion (review F11 / SEC-05) issues no
// session, so redirecting would land the caller on the login form with no
// explanation; the page must show the response message instead.

describe("resolveStaffRegistrationOutcome", () => {
  it("shows the response message instead of redirecting when the account was promoted", () => {
    const outcome = resolveStaffRegistrationOutcome(
      { student: { id: "tch-1", role: "admin" }, promoted: true, sessionIssued: false, message: "Now an admin. Sign in again." },
      "admin",
    );
    assert.deepEqual(outcome, { kind: "promoted", message: "Now an admin. Sign in again." });
  });

  it("falls back to a plain-language message when a promotion carries none", () => {
    const outcome = resolveStaffRegistrationOutcome({ promoted: true }, "admin");
    assert.equal(outcome.kind, "promoted");
    if (outcome.kind !== "promoted") return;
    assert.ok(outcome.message.length > 0);
    assert.match(outcome.message, /sign in/i);
    assert.ok(
      fleschKincaidGrade(outcome.message) <= PLAIN_LANGUAGE_MAX_GRADE,
      `fallback message grade ${fleschKincaidGrade(outcome.message).toFixed(1)} exceeds ${PLAIN_LANGUAGE_MAX_GRADE}`,
    );
  });

  it("redirects a newly created admin to /admin", () => {
    const outcome = resolveStaffRegistrationOutcome({ student: { id: "adm-1", role: "admin" } }, "admin");
    assert.deepEqual(outcome, { kind: "redirect", href: "/admin" });
  });

  it("redirects a newly created teacher to /teacher", () => {
    const outcome = resolveStaffRegistrationOutcome({ student: { id: "tch-1", role: "teacher" } }, "teacher");
    assert.deepEqual(outcome, { kind: "redirect", href: "/teacher" });
  });

  it("treats anything but promoted === true as a normal registration", () => {
    assert.equal(resolveStaffRegistrationOutcome({ promoted: "yes" }, "admin").kind, "redirect");
    assert.equal(resolveStaffRegistrationOutcome({ promoted: 1 }, "admin").kind, "redirect");
    assert.equal(resolveStaffRegistrationOutcome(null, "admin").kind, "redirect");
    assert.equal(resolveStaffRegistrationOutcome("promoted", "teacher").kind, "redirect");
  });
});
