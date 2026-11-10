import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { DemoAccountProvider } from "@/components/demo/DemoAccountContext";
import { STUDENT_PASSWORD_HINT } from "@/lib/password-policy";
import { fleschKincaidGrade, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import {
  ChangePasswordForm,
  ChangePasswordFormView,
  SETTINGS_SAVED_MESSAGE,
  checkBeforeSending,
  submitPasswordChange,
  type ChangePasswordFormViewProps,
} from "./ChangePasswordForm";
import {
  ChangePasswordScreen,
  FORCED_CURRENT_HINT,
  FORCED_CURRENT_LABEL,
  PasswordSavedConfirmation,
  SHARED_COMPUTER_TIP,
  SignOutButtonView,
  requestSignOut,
} from "./ChangePasswordScreen";
import { ChangePasswordSection, loginNameFrom } from "./ChangePasswordSection";
import { SIGNED_OUT_FORCED, SIGNED_OUT_SETTINGS, type RefusalView } from "./password-change-refusal";

// The change-password form (readiness A3), and the two places it appears: the
// screen a student is held on after staff set their password, and a section
// of Settings. There is no DOM here: state goes in through the View
// components, and what a response turns into is a pure function
// (password-change-refusal.test.ts).

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

function screenHtml(): string {
  return withRouter(<ChangePasswordScreen username="student1" />);
}

/** Every opening tag of this kind in the markup, as text. */
function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gu"))].map((match) => match[0]);
}

function tagWithId(html: string, name: string, id: string): string {
  const found = tags(html, name).find((tag) => tag.includes(`id="${id}"`));
  assert.ok(found, `no <${name} id="${id}">`);
  return found;
}

function text(html: string): string {
  return html.replace(/<!-- -->/gu, "").replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/\s+/gu, " ");
}

function formView(overrides: Partial<ChangePasswordFormViewProps> = {}): string {
  return withRouter(
    <ChangePasswordFormView
      idPrefix="t"
      currentLabel="Password you use now"
      username="student1"
      currentPassword="x"
      newPassword="green apple pie"
      onCurrentChange={() => undefined}
      onNewChange={() => undefined}
      status="error"
      refusal={null}
      sent
      onSubmit={() => undefined}
      {...overrides}
    />,
  );
}

const refusal = (place: RefusalView["place"], message: string, signIn = false): RefusalView => ({ place, message, signIn });

describe("ChangePasswordForm on Settings", () => {
  const html = renderToString(<ChangePasswordForm idPrefix="test" username="student1" />);
  const passwords = tags(html, "input").filter((input) => /type="password"/u.test(input));

  it("asks for the password in use now, then the new one", () => {
    assert.equal(passwords.length, 2);
    assert.match(passwords[0] ?? "", /id="test-current"/u);
    assert.match(passwords[0] ?? "", /autoComplete="current-password"/iu);
    assert.match(passwords[1] ?? "", /id="test-new"/u);
    assert.match(passwords[1] ?? "", /autoComplete="new-password"/iu);
  });

  it("keeps the Settings label, with no extra line under it", () => {
    assert.match(html, /<label[^>]*for="test-current"[^>]*>Password you use now<\/label>/u);
    assert.match(html, /<label[^>]*for="test-new"[^>]*>New password<\/label>/u);
    assert.doesNotMatch(html, /id="test-current-hint"/u);
    assert.doesNotMatch(tagWithId(html, "input", "test-current"), /aria-describedby/u);
  });

  it("shows the length rule under the new password before anything is typed", () => {
    assert.ok(text(html).includes(STUDENT_PASSWORD_HINT));
  });

  it("has one submit button, tall enough for a thumb", () => {
    const submit = tags(html, "button").filter((button) => /type="submit"/u.test(button));
    assert.equal(submit.length, 1);
    assert.match(submit[0] ?? "", /\bmin-h-11\b/u);
    assert.match(html, /<button[^>]*type="submit"[^>]*>Save new password<\/button>/u);
  });

  it("needs no router, so Settings can show it anywhere", () => {
    assert.ok(html.length > 0);
  });

  it("gives the fields their own ids when two forms could share a page", () => {
    const other = renderToString(<ChangePasswordForm idPrefix="settings-password" />);
    assert.match(other, /id="settings-password-current"/u);
    assert.match(other, /id="settings-password-new"/u);
  });
});

describe("the hidden username a password manager files the password under", () => {
  it("is a hidden, read-only username field holding the login name", () => {
    const html = renderToString(<ChangePasswordForm idPrefix="test" username="student1" />);
    const username = tags(html, "input").filter((input) => /autoComplete="username"/iu.test(input));

    assert.equal(username.length, 1);
    assert.match(username[0] ?? "", /value="student1"/u);
    assert.match(username[0] ?? "", /readOnly=""/iu);
    assert.match(username[0] ?? "", /\bhidden=""/u);
    assert.ok(html.indexOf('autoComplete="username"') < html.indexOf('id="test-current"'), "comes before the passwords");
  });

  it("is left out while the login name is unknown", () => {
    for (const username of [undefined, null]) {
      assert.doesNotMatch(renderToString(<ChangePasswordForm idPrefix="test" username={username} />), /autoComplete="username"/iu);
    }
  });
});

describe("where a refusal shows", () => {
  it("puts a wrong current password under the current field, marked invalid", () => {
    const html = formView({ refusal: refusal("current", "That is not the password you signed in with.") });
    const current = tagWithId(html, "input", "t-current");

    assert.match(current, /aria-invalid="true"/u);
    assert.match(current, /aria-describedby="t-current-refusal"/u);
    assert.ok(text(html).includes("That is not the password you signed in with."));
    assert.doesNotMatch(tagWithId(html, "input", "t-new"), /aria-invalid/u);
    assert.doesNotMatch(html, /role="alert"[^>]*>(?:(?!<\/p>).)*That is not/u, "not repeated above the button");
  });

  it("puts same-as-old and contains-your-username under the new field", () => {
    for (const message of ["Your new password must be different from the one you use now.", "Do not put your username in your password."]) {
      const html = formView({ refusal: refusal("new", message) });
      const fresh = tagWithId(html, "input", "t-new");

      assert.match(fresh, /aria-invalid="true"/u);
      assert.match(fresh, /aria-describedby="[^"]*\bt-new-refusal\b[^"]*"/u);
      assert.doesNotMatch(tagWithId(html, "input", "t-current"), /aria-invalid/u);
      assert.ok(html.indexOf('id="t-new-refusal"') < html.indexOf('type="submit"'));
    }
  });

  it("keeps network, limiter and fallback errors above the button", () => {
    const html = formView({ refusal: refusal("form", "We could not reach the server. Please try again.") });

    assert.match(html, /<div[^>]*role="alert"/u);
    assert.ok(html.indexOf('role="alert"') < html.indexOf('type="submit"'));
    assert.doesNotMatch(html, /-refusal"/u);
    for (const id of ["t-current", "t-new"]) assert.doesNotMatch(tagWithId(html, "input", id), /aria-invalid/u);
  });

  it("offers a way to sign in when the session ended", () => {
    const html = formView({ refusal: refusal("form", SIGNED_OUT_SETTINGS, true) });

    // The link carries "Sign in again", so the sentence does not repeat it.
    assert.equal(SIGNED_OUT_SETTINGS, "You were signed out.");
    assert.ok(text(html).includes("You were signed out. Sign in again"));
    const links = tags(html, "a");
    assert.equal(links.length, 1);
    assert.match(links[0] ?? "", /href="\/"/u);
    assert.match(links[0] ?? "", /\bmin-h-11\b/u);
    assert.match(html, /<a[^>]*>Sign in again<\/a>/u);
  });

  it("shows the Settings saved message, which says other devices are signed out", () => {
    const html = formView({ status: "saved" });
    assert.match(html, /<p[^>]*role="status"/u);
    assert.ok(text(html).includes(SETTINGS_SAVED_MESSAGE));
    assert.equal(SETTINGS_SAVED_MESSAGE, "Your new password is saved. Use it the next time you sign in. We signed you out on any other phone or computer.");
  });
});

describe("sending the change", () => {
  afterEach(() => mock.restoreAll());

  function answerWith(response: Response | Error): { calls: { url: string; init: RequestInit | undefined }[] } {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (response instanceof Error) throw response;
      return response;
    });
    return { calls };
  }

  it("posts both passwords to the change route as JSON, and nowhere else", async () => {
    const { calls } = answerWith(Response.json({ success: true, data: { changed: true } }));

    assert.deepEqual(await submitPasswordChange("the-old-password", "a brand new one", SIGNED_OUT_SETTINGS), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/settings/password");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { currentPassword: "the-old-password", newPassword: "a brand new one" });
  });

  it("answers a known refusal with its place and the server's words", async () => {
    answerWith(Response.json({ error: "Too many wrong tries. Wait 15 minutes, then try again.", code: "TOO_MANY_WRONG_TRIES" }, { status: 429 }));

    assert.deepEqual(await submitPasswordChange("x", "a brand new one", SIGNED_OUT_SETTINGS), {
      ok: false,
      refusal: { place: "form", message: "Too many wrong tries. Wait 15 minutes, then try again.", signIn: false },
    });
  });

  it("never shows Unauthorized: a 401 is the surface's signed-out sentence", async () => {
    answerWith(Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }));

    assert.deepEqual(await submitPasswordChange("x", "a brand new one", SIGNED_OUT_FORCED), {
      ok: false,
      refusal: { place: "form", message: SIGNED_OUT_FORCED, signIn: true },
    });
  });

  it("never shows Forbidden: origin mismatch.", async () => {
    answerWith(Response.json({ error: "Forbidden: origin mismatch." }, { status: 403 }));

    assert.deepEqual(await submitPasswordChange("x", "a brand new one", SIGNED_OUT_SETTINGS), {
      ok: false,
      refusal: { place: "form", message: "We could not change your password. Please try again.", signIn: false },
    });
  });

  it("answers a refusal that is not JSON with its own words", async () => {
    answerWith(new Response("<html>Bad gateway</html>", { status: 502 }));

    const result = await submitPasswordChange("x", "a brand new one", SIGNED_OUT_SETTINGS);
    assert.deepEqual(result, { ok: false, refusal: { place: "form", message: "We could not change your password. Please try again.", signIn: false } });
  });

  it("answers a dropped connection with words about the connection, not the password", async () => {
    answerWith(new TypeError("fetch failed"));

    const result = await submitPasswordChange("x", "a brand new one", SIGNED_OUT_SETTINGS);
    assert.deepEqual(result, { ok: false, refusal: { place: "form", message: "We could not reach the server. Please try again.", signIn: false } });
  });
});

describe("ChangePasswordScreen: the student is held here until they change it", () => {
  const html = screenHtml();
  const words = text(html);

  it("says why, and that this is normal", () => {
    assert.ok(words.includes("Your instructor set the password you just used. Choose a new one that only you know. This is a normal first step."), words);
  });

  it("has one top heading", () => {
    assert.equal(tags(html, "h1").length, 1);
    assert.match(html, /<h1[^>]*>Choose a New Password<\/h1>/u);
  });

  it("asks for the instructor's password, with a line tied to it", () => {
    assert.match(html, new RegExp(`<label[^>]*for="change-password-current"[^>]*>${FORCED_CURRENT_LABEL}</label>`, "u"));
    assert.equal(FORCED_CURRENT_LABEL, "Password your instructor gave you");
    assert.equal(FORCED_CURRENT_HINT, "Type it just as your instructor gave it, with the dashes.");
    assert.match(tagWithId(html, "input", "change-password-current"), /aria-describedby="change-password-current-hint"/u);
    assert.match(html, /<p[^>]*id="change-password-current-hint"[^>]*>Type it just as your instructor gave it, with the dashes\.<\/p>/u);
  });

  it("files the new password under the student's login name", () => {
    assert.match(html, /<input[^>]*autoComplete="username"[^>]*value="student1"/iu);
  });

  it("tells a student on a shared computer to say Never to saving it, above the Save button", () => {
    assert.equal(SHARED_COMPUTER_TIP, "Is this a shared computer? If it asks to save your password, tap Never or Not now.");
    assert.ok(words.includes(SHARED_COMPUTER_TIP), words);
    const tip = html.indexOf("Is this a shared computer?");
    assert.ok(tip > html.indexOf('id="change-password-new"'), "after the new password");
    assert.ok(tip < html.indexOf('type="submit"'), "before the Save button");
  });

  it("leaves the other devices line to Settings", () => {
    assert.ok(!words.includes("When you save it, we sign you out on any other phone or computer."), words);
  });

  it("gives a way out that is not the rest of the app: a Sign out button", () => {
    assert.ok(words.includes("Not ready? Sign out and do this later."), words);
    assert.match(html, /<button[^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>Sign out<\/button>/u);
    assert.equal(tags(html, "a").length, 0, "no link leads anywhere the proxy would only send back");
  });
});

describe("after the change on the forced screen", () => {
  const html = withRouter(<PasswordSavedConfirmation onContinue={() => undefined} />);

  it("says the password is saved in a box that takes focus, with no status role to read it twice", () => {
    const box = tags(html, "div").find((tag) => /tabindex="-1"/iu.test(tag));
    assert.ok(box, "a box that takes focus");
    assert.doesNotMatch(html, /role="status"/u);
    assert.ok(text(html).includes("Your new password is saved. You will use it the next time you sign in."));
  });

  it("repeats the shared computer tip inside the focused box: this is when the browser asks", () => {
    const start = html.indexOf('tabindex="-1"');
    const inside = html.slice(start, html.indexOf("</div>", start));
    assert.ok(text(inside).includes(SHARED_COMPUTER_TIP), inside);
  });

  it("puts Continue outside the focused box", () => {
    const start = html.indexOf('tabindex="-1"');
    const inside = html.slice(start, html.indexOf("</div>", start));
    assert.doesNotMatch(inside, /<button/u);
    assert.match(html, /Continue<\/button>/u);
  });

  it("has a Continue button and no step numbers", () => {
    assert.match(html, /<button[^>]*type="button"[^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>Continue<\/button>/u);
    assert.doesNotMatch(text(html), /\bstep\b|\d of \d/iu);
  });
});

describe("signing out from the forced screen", () => {
  afterEach(() => mock.restoreAll());

  function answerWith(response: Response | Error): void {
    mock.method(globalThis, "fetch", async () => {
      if (response instanceof Error) throw response;
      return response;
    });
  }

  it("counts only an answer the server gave as ok as signed out", async () => {
    answerWith(Response.json({ ok: true }));
    assert.equal(await requestSignOut(), true);
  });

  it("does not trust a 401: the sign out route never sends one, so it came from something in between", async () => {
    answerWith(Response.json({ error: "Unauthorized" }, { status: 401 }));
    assert.equal(await requestSignOut(), false);
  });

  it("counts a server error or a dropped connection as a failure, without throwing", async () => {
    answerWith(new Response("no", { status: 500 }));
    assert.equal(await requestSignOut(), false);
    answerWith(new TypeError("fetch failed"));
    assert.equal(await requestSignOut(), false);
  });

  it("says so and stays when it fails", () => {
    const failed = renderToString(<SignOutButtonView signingOut={false} failed onSignOut={() => undefined} />);
    assert.match(failed, /<p[^>]*role="alert"[^>]*>(?:(?!<\/p>).)*Could not sign out\. Try again\.<\/p>/u);
    assert.doesNotMatch(renderToString(<SignOutButtonView signingOut={false} failed={false} onSignOut={() => undefined} />), /role="alert"/u);
  });
});

describe("ChangePasswordSection: the Settings section", () => {
  it("shows the form under its own heading for a real student", () => {
    const html = renderToString(<ChangePasswordSection />);

    assert.match(html, /<h2[^>]*>Change Your Password<\/h2>/u);
    assert.match(html, /id="settings-password-current"/u);
    assert.ok(text(html).includes("You can change your password any time. You need the one you use now. We sign you out on any other phone or computer."));
  });

  it("shows nothing to a demo account, which has no password", () => {
    for (const kind of ["student", "instructor"] as const) {
      const html = renderToString(
        <DemoAccountProvider value={kind}>
          <ChangePasswordSection />
        </DemoAccountProvider>,
      );
      assert.equal(html, "", kind);
    }
  });

  it("reads the login name from the session answer, and nothing else", () => {
    assert.equal(loginNameFrom({ student: { studentId: "student1" } }), "student1");
    for (const body of [null, {}, { student: null }, { student: { studentId: 7 } }, { student: { studentId: "" } }, "x"]) {
      assert.equal(loginNameFrom(body), null);
    }
  });
});

describe("the words on these screens", () => {
  const screens = [
    screenHtml(),
    renderToString(<ChangePasswordSection />),
    withRouter(<PasswordSavedConfirmation onContinue={() => undefined} />),
    renderToString(<SignOutButtonView signingOut={false} failed onSignOut={() => undefined} />),
    formView({ refusal: refusal("form", SIGNED_OUT_FORCED, true) }),
    formView({ refusal: refusal("form", SIGNED_OUT_SETTINGS, true) }),
    formView({ status: "saved" }),
  ].map(text);

  it("hold no dash of any kind", () => {
    for (const words of screens) assert.doesNotMatch(words, /[-‐-―]/u, words);
  });

  it("read at a 6th-grade level, sentence by sentence", () => {
    const sentences = [
      "Your instructor set the password you just used. Choose a new one that only you know. This is a normal first step.",
      "Password your instructor gave you",
      "Type it just as your instructor gave it, with the dashes.",
      SHARED_COMPUTER_TIP,
      "Not ready? Sign out and do this later.",
      "Your new password is saved. You will use it the next time you sign in.",
      "Could not sign out. Try again.",
      "You can change your password any time. You need the one you use now. We sign you out on any other phone or computer.",
      SETTINGS_SAVED_MESSAGE,
      SIGNED_OUT_FORCED,
      SIGNED_OUT_SETTINGS,
    ];
    const shown = screens.join(" ");
    for (const sentence of sentences) {
      assert.ok(shown.includes(sentence), `not on screen: ${sentence}`);
      assert.ok(fleschKincaidGrade(sentence) <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${fleschKincaidGrade(sentence).toFixed(1)}: ${sentence}`);
    }
  });
});

describe("checkBeforeSending: what the form catches itself", () => {
  it("names the field's own label for an empty current password, under that field", () => {
    assert.deepEqual(checkBeforeSending("  ", "green apple pie", "Password your instructor gave you"), {
      place: "current",
      message: "Type the password your instructor gave you.",
      signIn: false,
    });
  });

  it("hands a too short new password to the new field, and sends anything else", () => {
    assert.equal(checkBeforeSending("old", "short", "Password you use now"), "too_short");
    assert.equal(checkBeforeSending("old", "green apple pie", "Password you use now"), null);
  });
});
