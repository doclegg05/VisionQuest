import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { DEMO_SIGNIN_NOTE } from "@/lib/demo/copy";
import AuthPageClient from "./AuthPageClient";

function withAppRouter(node: React.ReactNode) {
  const router = {
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
  return (
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      {node}
    </AppRouterContext.Provider>
  );
}

function render(props: { googleAuthEnabled: boolean; demoEnabled: boolean }) {
  return renderToString(withAppRouter(<AuthPageClient {...props} />));
}

const INSTRUCTOR_NOTE = "Your instructor will provide your username and password.";
const GOOGLE_OFF_NOTE = "Google sign-in is not enabled in this environment.";
const STUDENT_BUTTON = "Try the demo as a student";
const INSTRUCTOR_BUTTON = "Try the demo as an instructor";
const OR_DIVIDER = ">or</span>";

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

describe("AuthPageClient with the demo switch off", () => {
  it("renders the Google block, the instructor note and the staff link as before", () => {
    const html = render({ googleAuthEnabled: true, demoEnabled: false });
    assert.ok(html.includes("Sign in with Google"));
    assert.ok(html.includes(INSTRUCTOR_NOTE));
    assert.ok(html.includes("Staff? Register here"));
    assert.equal(count(html, OR_DIVIDER), 1, "expected the or divider above the Google button");
  });

  it("still explains a missing Google setup", () => {
    const html = render({ googleAuthEnabled: false, demoEnabled: false });
    assert.ok(html.includes(GOOGLE_OFF_NOTE));
    assert.ok(html.includes(INSTRUCTOR_NOTE));
    assert.ok(html.includes("Staff? Register here"));
  });

  it("shows nothing from the demo", () => {
    const html = render({ googleAuthEnabled: true, demoEnabled: false });
    assert.ok(!html.includes(STUDENT_BUTTON));
    assert.ok(!html.includes(INSTRUCTOR_BUTTON));
    assert.ok(!html.includes(DEMO_SIGNIN_NOTE));
    assert.ok(!html.includes("role=\"status\""));
  });
});

describe("AuthPageClient with the demo switch on", () => {
  for (const googleAuthEnabled of [true, false]) {
    describe(`and Google sign-in ${googleAuthEnabled ? "on" : "off"}`, () => {
      const html = render({ googleAuthEnabled, demoEnabled: true });

      it("shows the two demo buttons and the demo note, each once", () => {
        assert.equal(count(html, `>${STUDENT_BUTTON}</button>`), 1);
        assert.equal(count(html, `>${INSTRUCTOR_BUTTON}</button>`), 1);
        assert.equal(count(html, DEMO_SIGNIN_NOTE), 1);
      });

      it("puts the demo block after the password form, behind an or divider", () => {
        const form = html.indexOf("Forgot your password?");
        const divider = html.indexOf(OR_DIVIDER);
        const note = html.indexOf(DEMO_SIGNIN_NOTE);
        const student = html.indexOf(STUDENT_BUTTON);
        const instructor = html.indexOf(INSTRUCTOR_BUTTON);
        assert.equal(count(html, OR_DIVIDER), 1);
        assert.ok(form >= 0 && form < divider, "expected the divider after the form");
        assert.ok(divider < note, "expected the note after the divider");
        assert.ok(note < student, "expected the note above the student button");
        assert.ok(student < instructor, "expected the student button first");
      });

      it("takes the place of the Google block and the Google setup note", () => {
        assert.ok(!html.includes("Sign in with Google"));
        assert.ok(!html.includes(GOOGLE_OFF_NOTE));
      });

      it("drops the gray instructor note and hides the staff link", () => {
        assert.ok(!html.includes(INSTRUCTOR_NOTE));
        assert.ok(!html.includes("Staff? Register here"));
      });

      it("does not keep a second note box below the buttons", () => {
        const afterButtons = html.slice(html.indexOf(INSTRUCTOR_BUTTON));
        assert.ok(!afterButtons.includes(DEMO_SIGNIN_NOTE));
      });

      it("keeps the sign-in form", () => {
        assert.ok(html.includes('aria-label="Sign in"'));
        assert.ok(html.includes("Forgot your password?"));
      });
    });
  }
});
