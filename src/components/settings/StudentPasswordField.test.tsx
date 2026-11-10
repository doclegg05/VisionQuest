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

/** The visible words, with React's `&#x27;` read back as an apostrophe. */
function text(html: string): string {
  return html.replace(/<!-- -->/gu, "").replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/\s+/gu, " ");
}

describe("counting what the server will count", () => {
  it("counts the password trimmed, as sign-in and the schemas trim it", () => {
    assert.equal(typedPasswordLength("  green apple  "), "green apple".length);
    assert.equal(typedPasswordLength(""), 0);
    assert.equal(typedPasswordLength("   "), 0);
  });

  it("calls a password short until it reaches the rule", () => {
    assert.equal(isPasswordTooShort("a".repeat(MIN_PASSWORD_LENGTH - 1)), true);
    assert.equal(isPasswordTooShort(`${"a".repeat(MIN_PASSWORD_LENGTH - 1)}   `), true);
    assert.equal(isPasswordTooShort("a".repeat(MIN_PASSWORD_LENGTH)), false);
    assert.equal(isPasswordTooShort("green apple pie"), false);
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

    const enough = text(view({ value: "green apple pie" }));
    assert.ok(enough.includes("You have typed 15. That is long enough."), enough);
  });

  it("counts the trimmed password, the same number the server checks", () => {
    const html = text(view({ value: "   blue   " }));
    assert.ok(html.includes("You have typed 4."), html);
  });

  it("tells a screen reader once when the password becomes long enough, not on every key", () => {
    const short = view({ value: "blue" });
    const enough = view({ value: "green apple pie" });

    assert.match(short, /<span[^>]*aria-live="polite"[^>]*><\/span>/u);
    assert.match(enough, /<span[^>]*aria-live="polite"[^>]*>Your password is long enough\.<\/span>/u);
    assert.doesNotMatch(tag(enough.slice(enough.indexOf('id="new-password-count"') - 40), "p"), /aria-live/u);
  });

  it("has a Show button a thumb can hit, named for its field", () => {
    const html = view();
    const button = tag(html, "button");

    assert.match(button, /type="button"/u);
    assert.match(button, /aria-controls="new-password"/u);
    assert.match(button, /aria-label="Show new password"/u);
    assert.match(button, /\bmin-h-11\b/u);
    assert.match(html, /<button[^>]*>Show<\/button>/u);
  });

  it("keeps one width for Show and Hide, so the input does not jump when the word changes", () => {
    for (const revealed of [false, true]) {
      const button = tag(view({ revealed }), "button");
      assert.match(button, /\bw-20\b/u);
      assert.doesNotMatch(button, /\bmin-w-11\b/u);
      assert.match(button, /\bmin-h-11\b/u);
    }
  });

  it("says Hide while the password shows as text, in its words and its name", () => {
    const html = view({ value: "green apple pie", revealed: true });

    assert.match(tag(html, "input"), /type="text"/u);
    assert.match(tag(html, "button"), /aria-label="Hide new password"/u);
    assert.match(html, /<button[^>]*>Hide<\/button>/u);
  });

  it("never pairs a changing name with a pressed state", () => {
    for (const revealed of [false, true]) assert.doesNotMatch(tag(view({ revealed }), "button"), /aria-pressed/u);
  });

  it("starts hidden", () => {
    const html = renderToString(
      <StudentPasswordField id="p" label="New password" value="x" onChange={() => undefined} autoComplete="new-password" />,
    );

    assert.match(tag(html, "input"), /type="password"/u);
    assert.match(html, /<button[^>]*>Show<\/button>/u);
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

  it("is read once after sending: focus moves to the field, which describes it, so it is not an alert too", () => {
    const html = view({ value: "blue", showError: true });

    assert.doesNotMatch(tag(html.slice(html.indexOf('id="new-password-error"') - 20), "p"), /role="alert"/u);
    assert.match(tag(html, "input"), /aria-describedby="[^"]*\bnew-password-error\b[^"]*"/u);
  });

  it("carries the warning icon and layout the refusal uses, so it does not read as plain text in dark", () => {
    const html = view({ value: "blue", touched: true });
    const error = html.slice(html.indexOf('id="new-password-error"') - 10);

    assert.match(tag(error, "p"), /class="[^"]*\bflex items-start gap-2\b[^"]*"/u);
    assert.match(error.slice(0, error.indexOf("</p>")), /<svg[^>]*aria-hidden="true"/u);
  });

  it("does not nag about an empty field the student only passed through", () => {
    assert.ok(!text(view({ value: "", touched: true })).includes(STUDENT_PASSWORD_TOO_SHORT_MESSAGE));
  });

  it("clears the error once the password is long enough", () => {
    const html = view({ value: "green apple pie", touched: true, showError: true });

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

describe("StudentPasswordField: a line that says how to type it", () => {
  const html = view({
    id: "c",
    label: "Password your instructor gave you",
    autoComplete: "current-password",
    hint: "Type it the way you signed in, with the dashes.",
  });

  it("shows the line under the field and ties it with aria-describedby", () => {
    assert.match(html, /<p[^>]*id="c-hint"[^>]*>Type it the way you signed in, with the dashes\.<\/p>/u);
    assert.match(tag(html, "input"), /aria-describedby="c-hint"/u);
  });

  it("names the Show button with the field's label", () => {
    assert.match(tag(html, "button"), /aria-label="Show password your instructor gave you"/u);
  });
});

describe("StudentPasswordField: a refusal from the server about this field", () => {
  it("shows under the current field, marks it invalid and describes it", () => {
    const html = view({ id: "c", label: "Password you use now", autoComplete: "current-password", refusal: "That is not it." });

    assert.match(html, /<p[^>]*id="c-refusal"[^>]*>(?:(?!<\/p>).)*That is not it\.<\/p>/u);
    assert.match(tag(html, "input"), /aria-invalid="true"/u);
    assert.match(tag(html, "input"), /aria-describedby="c-refusal"/u);
  });

  it("shows under the new field after its rule and count", () => {
    const html = view({ value: "green apple pie", refusal: "Choose something else." });

    assert.match(tag(html, "input"), /aria-invalid="true"/u);
    assert.match(tag(html, "input"), /aria-describedby="new-password-refusal new-password-hint new-password-count"/u);
    assert.ok(html.indexOf('id="new-password-count"') < html.indexOf('id="new-password-refusal"'));
  });

  it("names the refusal before the hint on the current field too", () => {
    const html = view({ id: "c", label: "Password your instructor gave you", autoComplete: "current-password", hint: "A hint.", refusal: "That is not it." });
    assert.match(tag(html, "input"), /aria-describedby="c-refusal c-hint"/u);
  });

  it("is absent with no refusal", () => {
    assert.doesNotMatch(view({ value: "green apple pie" }), /-refusal"/u);
  });
});

describe("StudentPasswordField: the lines under the field are body size", () => {
  const html = view({ value: "blue", touched: true, refusal: "Choose something else." });
  const current = view({ id: "c", label: "Password your instructor gave you", autoComplete: "current-password", hint: "A hint." });

  for (const [name, markup, id] of [
    ["the rule", html, "new-password-hint"],
    ["the count", html, "new-password-count"],
    ["the too short error", html, "new-password-error"],
    ["the refusal", html, "new-password-refusal"],
    ["the current field's hint", current, "c-hint"],
  ] as const) {
    it(name, () => {
      const line = tag(markup.slice(markup.indexOf(`id="${id}"`) - 10), "p");
      assert.match(line, /\btext-base\b/u);
      assert.match(line, /\bleading-7\b/u);
      assert.doesNotMatch(line, /\btext-sm\b/u);
    });
  }
});
