import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { PASSWORD_LENGTH_HINT, STUDENT_PASSWORD_HINT } from "@/lib/password-policy";
import { changePasswordSchema } from "@/lib/schemas";
import { StudentPasswordFieldView, type StudentPasswordFieldViewProps } from "./StudentPasswordField";

// A hint that prints a password which passes every rule gets typed as is by a
// whole class, and then many accounts share one password the screen
// publishes. Every example a hint or placeholder gives is run through the
// same check the server applies to a new password: none may pass it.

/** The server's own rule for a student's new password. */
function serverAccepts(candidate: string): boolean {
  return changePasswordSchema.shape.newPassword.safeParse(candidate).success;
}

/** "a pet's name", "an animal": a kind of thing, not a thing to type. */
const DESCRIPTION = /^(?:a|an|the|your|some)\s/iu;

/**
 * The examples a sentence gives: anything in double quotes, and the run after
 * "like" up to the end of its sentence. A "like" list whose every item is a
 * description ("like a pet's name, a food and a place") is a recipe, not an
 * example, and gives none.
 */
function examplesIn(sentence: string): string[] {
  const quoted = [...sentence.matchAll(/["“]([^"”]+)["”]/gu)].map((match) => match[1] ?? "");
  const liked = [...sentence.matchAll(/\blike\s+([^.!?]+)/giu)]
    .map((match) => (match[1] ?? "").trim())
    .filter((run) => !run.split(/,\s*|\s+(?:and|or)\s+/u).every((item) => DESCRIPTION.test(item.trim())));
  return [...quoted, ...liked];
}

function view(overrides: Partial<StudentPasswordFieldViewProps>): string {
  return renderToString(
    <StudentPasswordFieldView
      id="p"
      label="New password"
      value=""
      onChange={() => undefined}
      autoComplete="new-password"
      revealed={false}
      onToggleReveal={() => undefined}
      touched={false}
      onBlur={() => undefined}
      {...overrides}
    />,
  );
}

function placeholders(html: string): string[] {
  return [...html.matchAll(/placeholder="([^"]*)"/gu)].map((match) => match[1] ?? "");
}

describe("finding the examples a hint gives", () => {
  it("finds a literal example after like, and in quotes", () => {
    assert.deepEqual(examplesIn("Three short words work, like blue river lamp."), ["blue river lamp"]);
    assert.deepEqual(examplesIn('Try "correct horse battery".'), ["correct horse battery"]);
  });

  it("finds none in a recipe of kinds of things", () => {
    assert.deepEqual(examplesIn("Try three words, like a pet's name, a food and a place."), []);
  });

  it("would catch the old hint, whose example passed every rule", () => {
    assert.ok(serverAccepts("blue river lamp"), "the check must be one that example passed");
  });
});

describe("no password hint or placeholder is itself a password the server accepts", () => {
  const field = [
    view({}),
    view({ autoComplete: "current-password", label: "Password your instructor gave you" }),
  ];
  const hints = [STUDENT_PASSWORD_HINT, PASSWORD_LENGTH_HINT];

  for (const hint of hints) {
    it(hint, () => {
      for (const example of examplesIn(hint)) {
        assert.equal(serverAccepts(example), false, `the hint publishes a working password: ${example}`);
      }
    });
  }

  it("the student field's placeholders, if it ever has any", () => {
    for (const placeholder of field.flatMap(placeholders)) {
      assert.equal(serverAccepts(placeholder), false, `a placeholder is a working password: ${placeholder}`);
      for (const example of examplesIn(placeholder)) assert.equal(serverAccepts(example), false, example);
    }
  });

  it("gives a recipe, built from the length rule, and no example", () => {
    assert.equal(
      STUDENT_PASSWORD_HINT,
      "Use 12 or more letters, numbers or symbols. Spaces count. Try three words that mean something to you, like a pet's name, a food and a place.",
    );
  });
});
