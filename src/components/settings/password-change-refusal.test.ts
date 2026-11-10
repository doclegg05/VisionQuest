import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PASSWORD_TOO_LONG_MESSAGE, STUDENT_PASSWORD_TOO_SHORT_MESSAGE } from "@/lib/password-policy";
import { fleschKincaidGrade, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import {
  FALLBACK_REFUSAL,
  MISSING_CURRENT_PASSWORD,
  NETWORK_REFUSAL,
  SIGNED_OUT_FORCED,
  SIGNED_OUT_SETTINGS,
  refusalView,
} from "./password-change-refusal";

// Where a refused password change shows and what it says. The form shows only
// sentences it knows: a server sentence reaches the student only under a code
// the form expects, and a raw "Unauthorized" or "Forbidden: origin mismatch."
// never does.

const SERVER = {
  wrong: "That is not the password you signed in with. Check each letter and type the dashes too. After 5 wrong tries you must wait 15 minutes.",
  spent: "Too many wrong tries. Wait 15 minutes, then try again. Or ask your instructor for help.",
  down: "We cannot change passwords right now. Try again in a few minutes, or ask your instructor for help. You can sign out and come back later.",
  none: "This account has no password yet. Sign out, then use Forgot your password to set one.",
  same: "Your new password must be different from the one you use now.",
  login: "Do not put your username in your password. Choose something else.",
  elsewhere: "Your instructor just set a new password for you. Sign in again with it.",
};

describe("refusalView: every code the change route sends", () => {
  const cases = [
    { status: 400, code: "WRONG_CURRENT_PASSWORD", error: SERVER.wrong, place: "current", signIn: false },
    { status: 400, code: "SAME_AS_CURRENT_PASSWORD", error: SERVER.same, place: "new", signIn: false },
    { status: 400, code: "PASSWORD_CONTAINS_LOGIN", error: SERVER.login, place: "new", signIn: false },
    { status: 400, code: "NO_PASSWORD_SET", error: SERVER.none, place: "form", signIn: false },
    { status: 429, code: "TOO_MANY_WRONG_TRIES", error: SERVER.spent, place: "form", signIn: false },
    { status: 503, code: "PASSWORD_CHANGE_UNAVAILABLE", error: SERVER.down, place: "form", signIn: false },
    { status: 409, code: "PASSWORD_CHANGED_ELSEWHERE", error: SERVER.elsewhere, place: "form", signIn: true },
  ] as const;

  for (const { status, code, error, place, signIn } of cases) {
    it(`${status} ${code} shows under ${place}`, () => {
      assert.deepEqual(refusalView(status, { error, code }, SIGNED_OUT_SETTINGS), { place, message: error, signIn });
    });
  }

  it("a known code under the wrong status is not trusted", () => {
    assert.deepEqual(refusalView(500, { error: SERVER.wrong, code: "WRONG_CURRENT_PASSWORD" }, SIGNED_OUT_SETTINGS), {
      place: "form",
      message: FALLBACK_REFUSAL,
      signIn: false,
    });
  });

  it("a known code with no words gets the form's fallback, in the form", () => {
    assert.deepEqual(refusalView(400, { code: "WRONG_CURRENT_PASSWORD" }, SIGNED_OUT_SETTINGS), {
      place: "form",
      message: FALLBACK_REFUSAL,
      signIn: false,
    });
  });
});

describe("refusalView: the schema's own answers", () => {
  it("puts a too short or too long new password under the new field", () => {
    for (const error of [STUDENT_PASSWORD_TOO_SHORT_MESSAGE, PASSWORD_TOO_LONG_MESSAGE]) {
      assert.deepEqual(refusalView(400, { error, code: "BAD_REQUEST" }, SIGNED_OUT_SETTINGS), { place: "new", message: error, signIn: false });
    }
  });

  it("puts an empty current password under the current field", () => {
    assert.deepEqual(refusalView(400, { error: MISSING_CURRENT_PASSWORD, code: "BAD_REQUEST" }, SIGNED_OUT_SETTINGS), {
      place: "current",
      message: MISSING_CURRENT_PASSWORD,
      signIn: false,
    });
  });

  it("does not show any other bad request sentence", () => {
    assert.deepEqual(refusalView(400, { error: "Invalid JSON body.", code: "BAD_REQUEST" }, SIGNED_OUT_SETTINGS), {
      place: "form",
      message: FALLBACK_REFUSAL,
      signIn: false,
    });
  });
});

describe("refusalView: a session that ended", () => {
  it("says so in plain words on Settings, with a way to sign in", () => {
    assert.deepEqual(refusalView(401, { error: "Unauthorized", code: "UNAUTHORIZED" }, SIGNED_OUT_SETTINGS), {
      place: "form",
      message: "You were signed out. Sign in again.",
      signIn: true,
    });
  });

  it("names the instructor's password on the forced screen", () => {
    assert.deepEqual(refusalView(401, null, SIGNED_OUT_FORCED), {
      place: "form",
      message: "You were signed out. Sign in again with the password your instructor gave you.",
      signIn: true,
    });
  });
});

describe("refusalView: anything else", () => {
  const unknown: [number, unknown][] = [
    [403, { error: "Forbidden: origin mismatch." }],
    [403, { error: "Only student accounts can change a password here.", code: "FORBIDDEN" }],
    [403, null],
    [500, { error: "Internal server error" }],
    [502, null],
    [400, { error: "" }],
    [400, { error: 42, code: 7 }],
    [418, "text"],
    [400, []],
  ];

  for (const [status, body] of unknown) {
    it(`${status} ${JSON.stringify(body)} shows the form's fallback`, () => {
      assert.deepEqual(refusalView(status, body, SIGNED_OUT_SETTINGS), { place: "form", message: FALLBACK_REFUSAL, signIn: false });
    });
  }
});

describe("the form's own sentences", () => {
  const own = [FALLBACK_REFUSAL, NETWORK_REFUSAL, MISSING_CURRENT_PASSWORD, SIGNED_OUT_FORCED, SIGNED_OUT_SETTINGS];

  it("read at a 6th-grade level with no dash", () => {
    for (const sentence of own) {
      assert.ok(fleschKincaidGrade(sentence) <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${fleschKincaidGrade(sentence).toFixed(1)}: ${sentence}`);
      assert.doesNotMatch(sentence, /[-‐-―]/u, sentence);
    }
  });
});
