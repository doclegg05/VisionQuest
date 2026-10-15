import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Account fields must tell password managers what they hold.
 *
 * The reset pages marked neither the account field nor the new password, so
 * Safari would not offer a strong password or update the saved one, and the
 * learner's next sign-in failed on the stale entry. Staff registration put a
 * shared program key in an unmarked password field above the real password,
 * so Keychain filled or saved the wrong value (HIG review E-7, E-11, E-16).
 *
 * Read from source because the reset form sits behind useSearchParams and the
 * emailed-reset login field is hidden until its tab is chosen.
 */

function inputTag(file: string, id: string): string {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const match = source.match(new RegExp(`<input\\b[^>]*?\\bid="${id}"[\\s\\S]*?/>`));
  assert.ok(match, `${file}: no <input id="${id}">`);
  return match[0];
}

function assertAttr(file: string, id: string, attr: string) {
  assert.ok(inputTag(file, id).includes(attr), `${file} #${id} needs ${attr}`);
}

const NO_AUTOCORRECT = ['autoCapitalize="none"', 'autoCorrect="off"', "spellCheck={false}"];

describe("forgot-password autofill", () => {
  const file = "src/app/forgot-password/page.tsx";

  for (const id of ["question-login", "email-login"]) {
    it(`#${id} is the account's username, typed exactly`, () => {
      for (const attr of ['autoComplete="username"', ...NO_AUTOCORRECT]) assertAttr(file, id, attr);
    });
  }

  for (const id of ["new-password", "confirm-password"]) {
    it(`#${id} is a new password`, () => assertAttr(file, id, 'autoComplete="new-password"'));
  }
});

describe("reset-password autofill", () => {
  const file = "src/app/reset-password/page.tsx";

  for (const id of ["password", "confirm-password"]) {
    it(`#${id} is a new password`, () => assertAttr(file, id, 'autoComplete="new-password"'));
  }
});

describe("teacher-register autofill", () => {
  const file = "src/app/teacher-register/page.tsx";

  it("keeps password managers out of the registration key", () => {
    for (const attr of ['autoComplete="off"', "data-1p-ignore", 'data-lpignore="true"', ...NO_AUTOCORRECT]) {
      assertAttr(file, "registrationKey", attr);
    }
  });

  it("marks the display name as a name", () => assertAttr(file, "displayName", 'autoComplete="name"'));
});
