import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import {
  MIN_PASSWORD_LENGTH,
  STUDENT_PASSWORD_HINT,
  STUDENT_PASSWORD_TOO_SHORT_MESSAGE,
} from "@/lib/password-policy";
import {
  StudentPasswordField,
  StudentPasswordFieldView,
  isPasswordTooShort,
  typedPasswordLength,
  type StudentPasswordFieldViewProps,
} from "./StudentPasswordField";

// One password field for students (readiness A3), used by the change screen,
// the Settings section and both recovery pages. A student sees the rule
// before typing, a count while typing, and can look at what they typed.
// These students are adults, many with low literacy, often on a phone: a
// placeholder that vanishes on the first key is not a hint.

function view(overrides: Partial<StudentPasswordFieldViewProps> = {}): string {
  return renderToString(
    <StudentPasswordFieldView
      id="new-password"
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

/** The first tag of this kind in the markup, as text. */
function tag(html: string, name: string): string {
  const match = html.match(new RegExp(`<${name}\\b[^>]*>`, "u"));
  assert.ok(match, `no <${name}> in the markup`);
  return match[0];
}

/** React writes `&#x27;` and friends; the copy under test has none of those. */
function text(html: string): string {
  return html.replace(/<!-- -->/gu, "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
}

describe("counting what the server will count", () => {
  it("counts the password trimmed, as sign-in and the schemas trim it", () => {
    assert.equal(typedPasswordLength("  blue river  "), "blue river".length);
    assert.equal(typedPasswordLength(""), 0);
    assert.equal(typedPasswordLength("   "), 0);
  });

  it("calls a password short until it reaches the rule", () => {
    assert.equal(isPasswordTooShort("a".repeat(MIN_PASSWORD_LENGTH - 1)), true);
    assert.equal(isPasswordTooShort(`${"a".repeat(MIN_PASSWORD_LENGTH - 1)}   `), true);
    assert.equal(isPasswordTooShort("a".repeat(MIN_PASSWORD_LENGTH)), false);
    assert.equal(isPasswordTooShort("blue river lamp"), false);
  });
});

describe("StudentPasswordField: a new password", () => {
  it("is a labelled password input marked as a new password", () => {
    const html = view();
    const input = tag(html, "input");

    assert.match(input, /id="new-password"/u);
    assert.match(input, /type="password"/u);
    assert.match(input, /autoComplete="new-password"/iu);
    assert.match(html, /<label[^>]*for="new-password"[^>]*>New password<\/label>/u);
  });

  it("is typed exactly: no capitals, corrections or spell check from the keyboard", () => {
    const input = tag(view(), "input");

    assert.match(input, /autoCapitalize="none"/iu);
    assert.match(input, /autoCorrect="off"/iu);
    assert.match(input, /spellCheck="false"/iu);
  });

  it("shows the rule under the field, always, and ties it to the field", () => {
    const html = view();

    assert.ok(text(html).includes(STUDENT_PASSWORD_HINT));
    assert.match(html, /<p[^>]*id="new-password-hint"/u);
    assert.match(tag(html, "input"), /aria-describedby="new-password-hint new-password-count"/u);
    assert.doesNotMatch(tag(html, "input"), /placeholder=/u, "the rule must not live in a placeholder");
  });

  it("counts what was typed against the number the rule is built from", () => {
    const short = text(view({ value: "blue" }));
    assert.ok(short.includes(`You have typed 4. You need ${MIN_PASSWORD_LENGTH} or more.`), short);

    const none = text(view({ value: "" }));
    assert.ok(none.includes(`You have typed 0. You need ${MIN_PASSWORD_LENGTH} or more.`), none);

    const enough = text(view({ value: "blue river lamp" }));
    assert.ok(enough.includes("You have typed 15. That is long enough."), enough);
  });

  it("counts the trimmed password, the same number the server checks", () => {
    const html = text(view({ value: "   blue   " }));
    assert.ok(html.includes("You have typed 4."), html);
  });

  it("tells a screen reader once when the password becomes long enough, not on every key", () => {
    const short = view({ value: "blue" });
    const enough = view({ value: "blue river lamp" });

    assert.match(short, /<span[^>]*aria-live="polite"[^>]*><\/span>/u);
    assert.match(enough, /<span[^>]*aria-live="polite"[^>]*>Your password is long enough\.<\/span>/u);
    assert.doesNotMatch(tag(enough.slice(enough.indexOf('id="new-password-count"') - 40), "p"), /aria-live/u);
  });

  it("has a Show button a thumb can hit, that says whether it is on", () => {
    const html = view();
    const button = tag(html, "button");

    assert.match(button, /type="button"/u);
    assert.match(button, /aria-pressed="false"/u);
    assert.match(button, /aria-controls="new-password"/u);
    assert.match(button, /aria-label="Show new password"/u);
    assert.match(button, /\bmin-h-11\b/u);
    assert.match(button, /\bmin-w-11\b/u);
    assert.match(html, /<button[^>]*>Show<\/button>/u);
  });

  it("shows the password as text while Show is on, and says so", () => {
    const html = view({ value: "blue river lamp", revealed: true });

    assert.match(tag(html, "input"), /type="text"/u);
    assert.match(tag(html, "button"), /aria-pressed="true"/u);
    assert.match(html, /<button[^>]*>Show<\/button>/u, "the name stays the same; aria-pressed carries the state");
  });

  it("starts hidden", () => {
    const html = renderToString(
      <StudentPasswordField id="p" label="New password" value="x" onChange={() => undefined} autoComplete="new-password" />,
    );

    assert.match(tag(html, "input"), /type="password"/u);
    assert.match(tag(html, "button"), /aria-pressed="false"/u);
  });
});

describe("StudentPasswordField: a password that is too short", () => {
  it("says nothing while the student is still typing for the first time", () => {
    const html = view({ value: "blue" });

    assert.ok(!text(html).includes(STUDENT_PASSWORD_TOO_SHORT_MESSAGE));
    assert.doesNotMatch(tag(html, "input"), /aria-invalid="true"/u);
  });

  it("shows the error once the student leaves the field", () => {
    const html = view({ value: "blue", touched: true });

    assert.match(html, /<p[^>]*id="new-password-error"[^>]*role="alert"/u);
    assert.ok(text(html).includes(STUDENT_PASSWORD_TOO_SHORT_MESSAGE));
    assert.match(tag(html, "input"), /aria-invalid="true"/u);
    assert.match(tag(html, "input"), /aria-describedby="new-password-hint new-password-count new-password-error"/u);
  });

  it("shows the error when the form was sent, even if the field was never touched", () => {
    const html = view({ value: "", showError: true });

    assert.ok(text(html).includes(STUDENT_PASSWORD_TOO_SHORT_MESSAGE));
  });

  it("does not nag about an empty field the student only passed through", () => {
    assert.ok(!text(view({ value: "", touched: true })).includes(STUDENT_PASSWORD_TOO_SHORT_MESSAGE));
  });

  it("clears the error once the password is long enough", () => {
    const html = view({ value: "blue river lamp", touched: true, showError: true });

    assert.ok(!text(html).includes(STUDENT_PASSWORD_TOO_SHORT_MESSAGE));
    assert.doesNotMatch(tag(html, "input"), /aria-invalid="true"/u);
  });
});

describe("StudentPasswordField: the password in use now", () => {
  const html = view({ id: "current-password", label: "Password you use now", autoComplete: "current-password", value: "x" });

  it("is marked as the current password, so a password manager fills the right one", () => {
    assert.match(tag(html, "input"), /autoComplete="current-password"/iu);
    assert.match(tag(html, "input"), /type="password"/u);
  });

  it("shows no length rule, count or error: the server only checks that it matches", () => {
    assert.ok(!text(html).includes(STUDENT_PASSWORD_HINT));
    assert.ok(!text(html).includes("You have typed"));
    assert.doesNotMatch(tag(html, "input"), /aria-describedby/u);
    assert.ok(!text(view({ id: "c", label: "Password you use now", autoComplete: "current-password", value: "x", touched: true, showError: true })).includes(STUDENT_PASSWORD_TOO_SHORT_MESSAGE));
  });

  it("still has a Show button: an instructor-made password is easy to mistype", () => {
    assert.match(tag(html, "button"), /aria-label="Show password you use now"/u);
    assert.match(tag(html, "button"), /\bmin-h-11\b/u);
  });
});
