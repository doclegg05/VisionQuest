import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { PASSWORD_LENGTH_HINT, STUDENT_PASSWORD_HINT } from "@/lib/password-policy";
import { changePasswordSchema } from "@/lib/schemas";
import { ChangePasswordFormView } from "./ChangePasswordForm";
import { ChangePasswordScreen, FORCED_CURRENT_HINT, PasswordSavedConfirmation, SHARED_COMPUTER_TIP } from "./ChangePasswordScreen";
import { ChangePasswordSection } from "./ChangePasswordSection";
import { SIGNED_OUT_FORCED, SIGNED_OUT_SETTINGS } from "./password-change-refusal";

// A hint that prints a password which passes every rule gets typed as is by a
// whole class, and then many accounts share one password the screen
// publishes. Every example the password screens give is run through the same
// check the server applies to a new password: none may pass it.
//
// What counts as an example is an allowlist, not a guess. A "like" list
// passes only when every item is one of the recipe items below. Any other run
// after "like", "such as", "for example" or "e.g.", and anything in quotes, is
// a literal a student could type, and the server must refuse it.

/** The server's own rule for a student's new password. */
function serverAccepts(candidate: string): boolean {
  return changePasswordSchema.shape.newPassword.safeParse(candidate).success;
}

/** The kinds of thing a hint may name. Each is a recipe step, not a thing to type. */
const RECIPE_ITEMS: ReadonlySet<string> = new Set(["a pet's name", "a food", "a place"]);

/**
 * The run after a lead-in, up to the end of its sentence. A sentence ends at
 * . ! or ? followed by a space or the end, so "blue.river.lamp1" stays whole.
 */
const LEAD_IN = /(?<![\p{L}\p{N}])(?:like|such as|for example|for instance|e\.g\.?|i\.e\.?|example:)(?![\p{L}\p{N}])[,:]?\s+(.+?)(?=[.!?](?:\s|$)|$)/giu;

/** Anything in double or single quotes, straight or curly. An apostrophe inside a word opens nothing. */
const QUOTED = [/"([^"]+)"/gu, /“([^”]+)”/gu, /‘([^’]+)’/gu, /`([^`]+)`/gu, /«([^»]+)»/gu, /(?<![\p{L}\p{N}])'([^']+)'(?![\p{L}\p{N}])/gu];

const ITEM_SPLIT = /,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+/u;

function isRecipe(run: string): boolean {
  return run
    .split(ITEM_SPLIT)
    .map((item) => item.trim().toLowerCase().replace(/’/gu, "'"))
    .every((item) => RECIPE_ITEMS.has(item));
}

/** Every literal a piece of text gives, which the server must refuse. */
function examplesIn(words: string): string[] {
  const quoted = QUOTED.flatMap((pattern) => [...words.matchAll(pattern)].map((match) => match[1] ?? ""));
  const led = [...words.matchAll(LEAD_IN)].map((match) => (match[1] ?? "").trim()).filter((run) => !isRecipe(run));
  return [...quoted, ...led];
}

/** The literals in this text that the server would take as a new password. */
function publishedPasswords(words: string): string[] {
  return examplesIn(words).filter(serverAccepts);
}

describe("finding the examples a piece of text gives", () => {
  it("finds a literal after like, and in double quotes", () => {
    assert.deepEqual(examplesIn("Three short words work, like blue river lamp."), ["blue river lamp"]);
    assert.deepEqual(examplesIn('Try "correct horse battery".'), ["correct horse battery"]);
  });

  it("finds none in the recipe, with either apostrophe or an Oxford comma", () => {
    assert.deepEqual(examplesIn("Try three words, like a pet's name, a food and a place."), []);
    assert.deepEqual(examplesIn("Try three words, like a pet’s name, a food, and a place."), []);
  });

  it("does not read an apostrophe inside a word as a quote", () => {
    assert.deepEqual(examplesIn("Don't use your dog's name."), []);
  });

  it("is a check the old example would fail", () => {
    assert.ok(serverAccepts("blue river lamp"), "the check must be one that example passed");
  });
});

describe("the ways round the old guard are caught", () => {
  const bypasses = [
    ["an article after like", "Try three words, like the quick brown fox.", "the quick brown fox"],
    ["single quotes", "Try 'blue river lamp' as your password.", "blue river lamp"],
    ["for example", "Try three words, for example blue river lamp.", "blue river lamp"],
    ["e.g.", "Try three words, e.g. blue river lamp.", "blue river lamp"],
    ["such as", "Try three words, such as blue river lamp.", "blue river lamp"],
    ["a period inside the example", "Try something like blue.river.lamp1.", "blue.river.lamp1"],
    ["for instance", "For instance, blue river lamp.", "blue river lamp"],
    ["e.g without a period", "Try three words, e.g blue river lamp", "blue river lamp"],
    ["i.e.", "Use three words, i.e. blue river lamp.", "blue river lamp"],
    ["example with a colon", "Example: blue river lamp.", "blue river lamp"],
    ["backticks", "Try `blue river lamp` as your password.", "blue river lamp"],
    ["guillemets", "Try «blue river lamp» as your password.", "blue river lamp"],
  ] as const;

  for (const [name, sentence, literal] of bypasses) {
    it(name, () => {
      assert.deepEqual(publishedPasswords(sentence), [literal]);
    });
  }
});

const ROUTER: AppRouterInstance = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "test",
};

function withRouter(node: React.ReactNode): string {
  return renderToString(<AppRouterContext.Provider value={ROUTER}>{node}</AppRouterContext.Provider>);
}

function settingsForm(overrides: Partial<React.ComponentProps<typeof ChangePasswordFormView>>): string {
  return renderToString(
    <ChangePasswordFormView
      idPrefix="s"
      currentLabel="Password you use now"
      currentPassword=""
      newPassword=""
      onCurrentChange={() => undefined}
      onNewChange={() => undefined}
      status="idle"
      refusal={null}
      sent={false}
      onSubmit={() => undefined}
      {...overrides}
    />,
  );
}

/** Every state of the two password screens a student can see. */
const SCREENS = [
  withRouter(<ChangePasswordScreen username="student1" />),
  withRouter(<PasswordSavedConfirmation onContinue={() => undefined} />),
  renderToString(<ChangePasswordSection />),
  settingsForm({ status: "saved" }),
  settingsForm({ status: "error", refusal: { place: "form", message: SIGNED_OUT_SETTINGS, signIn: true } }),
  settingsForm({ status: "error", refusal: { place: "form", message: SIGNED_OUT_FORCED, signIn: true } }),
  settingsForm({ newPassword: "short", sent: true }),
];

function decode(html: string): string {
  return html.replace(/&#x27;/gu, "'").replace(/&quot;/gu, '"').replace(/&amp;/gu, "&");
}

/** The words of one element per line, so a sentence never runs into the next element. */
function visibleLines(html: string): string[] {
  return decode(html.replace(/<!-- -->/gu, ""))
    .split(/<[^>]+>/u)
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter((part) => part !== "");
}

/** Words a screen reader or a placeholder gives that are not element text. */
function attributeWords(html: string): string[] {
  return [...html.matchAll(/\s(?:placeholder|aria-label|title)="([^"]*)"/gu)].map((match) => decode(match[1] ?? ""));
}

/** The text of every hint the screens tie to a field, and every placeholder. */
function hintsOnScreens(): string[] {
  return SCREENS.flatMap((html) => [
    ...[...html.matchAll(/<p[^>]*id="[^"]*-hint"[^>]*>([^<]*)<\/p>/gu)].map((match) => decode(match[1] ?? "")),
    ...[...html.matchAll(/placeholder="([^"]*)"/gu)].map((match) => decode(match[1] ?? "")),
  ]);
}

/**
 * The hints these screens give, each checked on its own below. A hint added
 * to a screen and not to this list fails "every hint on the screens is
 * listed". PASSWORD_LENGTH_HINT is not on these screens; it is listed so the
 * shared rule text is checked too.
 */
const HINTS = [STUDENT_PASSWORD_HINT, PASSWORD_LENGTH_HINT, FORCED_CURRENT_HINT, SHARED_COMPUTER_TIP];

describe("no hint on the password screens is itself a password the server accepts", () => {
  for (const hint of HINTS) {
    it(hint, () => {
      assert.deepEqual(publishedPasswords(hint), [], `the hint publishes a working password`);
    });
  }

  it("every hint on the screens is listed above", () => {
    const found = hintsOnScreens();
    assert.ok(found.length > 0, "the screens show hints, so finding none means the search is broken");
    for (const hint of found) assert.ok(HINTS.includes(hint), `a hint on the screens is not listed: ${hint}`);
  });

  it("the tip shows on the screens, where the guard below reads it", () => {
    assert.ok(SCREENS.some((html) => visibleLines(html).includes(SHARED_COMPUTER_TIP)));
  });

  it("nothing else a student reads on these screens publishes one either", () => {
    for (const html of SCREENS) {
      for (const words of [...visibleLines(html), ...attributeWords(html)]) {
        assert.deepEqual(publishedPasswords(words), [], words);
      }
    }
  });

  it("no placeholder is itself a password the server accepts, if the fields ever get one", () => {
    for (const html of SCREENS) {
      for (const match of html.matchAll(/placeholder="([^"]*)"/gu)) {
        assert.equal(serverAccepts(decode(match[1] ?? "")), false, match[1]);
      }
    }
  });

  // The phrase patterns above cannot list every way to put a password in a
  // sentence ("Try three words: blue river lamp." passes them). So every line
  // a student reads on these screens is on this list, which a person checked
  // for a literal password. A new or changed sentence fails here until it is
  // read and added. The list holds the words themselves, never a constant,
  // so changing a constant cannot change the list with it. The typed-count
  // line is matched by its shape.
  it("every line on the screens was read by a person and has no password in it", () => {
    const reviewed: ReadonlySet<string> = new Set([
      "Change Your Password",
      "Choose a New Password",
      "Continue",
      "Is this a shared computer? If it asks to save your password, tap Never or Not now.",
      "New password",
      "Not ready? Sign out and do this later.",
      "One quick step",
      "Password you use now",
      "Password your instructor gave you",
      "Save new password",
      "Show",
      "Show new password",
      "Show password you use now",
      "Show password your instructor gave you",
      "Sign in",
      "Sign in again",
      "Sign out",
      "Type it just as your instructor gave it, with the dashes.",
      "Use 12 or more letters, numbers or symbols. Spaces count. Try three words that mean something to you, like a pet's name, a food and a place.",
      "Username",
      "You can change your password any time. You need the one you use now. We sign you out on any other phone or computer.",
      "You were signed out.",
      "You were signed out. Sign in again with the password your instructor gave you.",
      "Your instructor set the password you just used. Choose a new one that only you know. This is a normal first step.",
      "Your new password is saved. Use it the next time you sign in. We signed you out on any other phone or computer.",
      "Your new password is saved. You will use it the next time you sign in.",
      "Your password is too short. Use 12 or more letters, numbers or symbols.",
    ]);
    const typedCount = /^You have typed \d+\. (?:You need 12 or more\.|That is long enough\.)$/u;
    for (const html of SCREENS) {
      for (const words of [...visibleLines(html), ...attributeWords(html)]) {
        assert.ok(reviewed.has(words) || typedCount.test(words), `a line nobody has checked: ${words}`);
      }
    }
  });

  it("gives a recipe, built from the length rule, and no example", () => {
    assert.equal(
      STUDENT_PASSWORD_HINT,
      "Use 12 or more letters, numbers or symbols. Spaces count. Try three words that mean something to you, like a pet's name, a food and a place.",
    );
  });
});
