import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { DemoAccountProvider } from "@/components/demo/DemoAccountContext";
import { STUDENT_PASSWORD_HINT } from "@/lib/password-policy";
import { fleschKincaidGrade, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import { ChangePasswordForm, changeFailureMessage, submitPasswordChange } from "./ChangePasswordForm";
import { ChangePasswordScreen } from "./ChangePasswordScreen";
import { ChangePasswordSection } from "./ChangePasswordSection";

// The change-password form (readiness A3), and the two places it appears: the
// screen a student is held on after staff set their password, and a section
// of Settings. First render only: there is no DOM here, so what a click does
// is covered by the field's own tests and the route's.

const ROUTER: AppRouterInstance = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "test",
};

/** The forced screen calls useRouter() to move on; give it one, as the forgot-password page test does. */
function screenHtml(): string {
  return renderToString(
    <AppRouterContext.Provider value={ROUTER}>
      <ChangePasswordScreen />
    </AppRouterContext.Provider>,
  );
}

/** Every opening tag of this kind in the markup, as text. */
function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gu"))].map((match) => match[0]);
}

function text(html: string): string {
  return html.replace(/<!-- -->/gu, "").replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/\s+/gu, " ");
}

describe("ChangePasswordForm", () => {
  const html = renderToString(<ChangePasswordForm idPrefix="test" />);
  const inputs = tags(html, "input");

  it("asks for the password in use now, then the new one, and nothing else", () => {
    assert.equal(inputs.length, 2);
    assert.match(inputs[0] ?? "", /id="test-current"/u);
    assert.match(inputs[0] ?? "", /autoComplete="current-password"/iu);
    assert.match(inputs[1] ?? "", /id="test-new"/u);
    assert.match(inputs[1] ?? "", /autoComplete="new-password"/iu);
  });

  it("keeps both as password inputs with a label each", () => {
    for (const input of inputs) assert.match(input, /type="password"/u);
    assert.match(html, /<label[^>]*for="test-current"[^>]*>Password you use now<\/label>/u);
    assert.match(html, /<label[^>]*for="test-new"[^>]*>New password<\/label>/u);
  });

  it("shows the length rule under the new password before anything is typed", () => {
    assert.ok(text(html).includes(STUDENT_PASSWORD_HINT));
  });

  it("has one submit button, tall enough for a thumb", () => {
    const submit = tags(html, "button").filter((button) => /type="submit"/u.test(button));
    assert.equal(submit.length, 1);
    assert.match(submit[0] ?? "", /\bprimary-button\b/u);
    assert.match(submit[0] ?? "", /\bmin-h-11\b/u);
    assert.match(html, /<button[^>]*type="submit"[^>]*>Save new password<\/button>/u);
  });

  it("needs no router, so Settings can show it anywhere", () => {
    // Rendered above with no AppRouterContext at all. Moving on after a
    // change is the caller's job, through `onChanged`.
    assert.ok(html.length > 0);
  });

  it("gives the two fields their own ids when two forms could share a page", () => {
    const other = renderToString(<ChangePasswordForm idPrefix="settings-password" />);
    assert.match(other, /id="settings-password-current"/u);
    assert.match(other, /id="settings-password-new"/u);
  });
});

describe("what the form says when the change is refused", () => {
  it("shows the server's words when it sent some", () => {
    assert.equal(
      changeFailureMessage({ error: "That is not the password you use now. Check it and try again." }),
      "That is not the password you use now. Check it and try again.",
    );
  });

  it("falls back to its own words for anything else", () => {
    for (const body of [null, undefined, {}, { error: "" }, { error: 42 }, "text", []]) {
      assert.equal(changeFailureMessage(body), "We could not change your password. Please try again.");
    }
  });
});

describe("sending the change", () => {
  afterEach(() => mock.restoreAll());

  /** Stands in for the network: records the one request and answers it. */
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

    const result = await submitPasswordChange("the-old-password", "a brand new one");

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/settings/password");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      currentPassword: "the-old-password",
      newPassword: "a brand new one",
    });
  });

  it("answers a refusal with the server's words", async () => {
    answerWith(Response.json({ error: "Too many wrong tries. Wait 15 minutes, then try again.", code: "TOO_MANY_WRONG_TRIES" }, { status: 429 }));

    assert.deepEqual(await submitPasswordChange("x", "a brand new one"), {
      ok: false,
      message: "Too many wrong tries. Wait 15 minutes, then try again.",
    });
  });

  it("answers a refusal that is not JSON with its own words", async () => {
    answerWith(new Response("<html>Bad gateway</html>", { status: 502 }));

    assert.deepEqual(await submitPasswordChange("x", "a brand new one"), {
      ok: false,
      message: "We could not change your password. Please try again.",
    });
  });

  it("answers a dropped connection with words about the connection, not the password", async () => {
    answerWith(new TypeError("fetch failed"));

    assert.deepEqual(await submitPasswordChange("x", "a brand new one"), {
      ok: false,
      message: "We could not reach the server. Please try again.",
    });
  });
});

describe("ChangePasswordScreen: the student is held here until they change it", () => {
  const html = screenHtml();
  const words = text(html);

  it("says why, in the words this task was given", () => {
    assert.ok(words.includes("Your instructor set this password. Choose a new one that only you know."), words);
  });

  it("has one top heading", () => {
    assert.equal(tags(html, "h1").length, 1);
    assert.match(html, /<h1[^>]*>Choose a New Password<\/h1>/u);
  });

  it("holds the form", () => {
    assert.match(html, /id="change-password-current"/u);
    assert.match(html, /id="change-password-new"/u);
  });

  it("gives a way out that is not the rest of the app: a Sign out button", () => {
    const signOut = tags(html, "button").filter((button) => /type="button"/u.test(button) && !/aria-pressed/u.test(button));
    assert.equal(signOut.length, 1);
    assert.match(signOut[0] ?? "", /\bmin-h-11\b/u);
    assert.match(html, /<button[^>]*>Sign out<\/button>/u);
    assert.equal(tags(html, "a").length, 0, "no link leads anywhere the proxy would only send back");
  });
});

describe("ChangePasswordSection: the Settings section", () => {
  it("shows the form under its own heading for a real student", () => {
    const html = renderToString(<ChangePasswordSection />);

    assert.match(html, /<h2[^>]*>Change Your Password<\/h2>/u);
    assert.match(html, /id="settings-password-current"/u);
    assert.match(html, /id="settings-password-new"/u);
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
});

describe("the words on these screens", () => {
  const screens = [
    screenHtml(),
    renderToString(<ChangePasswordSection />),
  ].map(text);

  it("hold no dash of any kind", () => {
    for (const words of screens) assert.doesNotMatch(words, /[-‐-―]/u, words);
  });

  it("read at a 6th-grade level, sentence by sentence", () => {
    const sentences = [
      "Your instructor set this password. Choose a new one that only you know.",
      "When you save it, we sign you out on any other phone or computer.",
      "You can change your password any time. You need the one you use now.",
      "Your new password is saved. Use it the next time you sign in.",
      "We could not change your password. Please try again.",
      "We could not reach the server. Please try again.",
    ];
    const shown = screens.join(" ");
    for (const sentence of sentences.slice(0, 3)) assert.ok(shown.includes(sentence), `not on screen: ${sentence}`);
    for (const sentence of sentences) {
      assert.ok(fleschKincaidGrade(sentence) <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${fleschKincaidGrade(sentence).toFixed(1)}: ${sentence}`);
    }
  });
});
