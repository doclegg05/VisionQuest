import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { DEMO_ENTER_INSTRUCTOR, DEMO_ENTER_STUDENT, DEMO_SIGNIN_NOTE } from "@/lib/demo/copy";
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

describe("AuthPageClient with the demo switch off", () => {
  it("renders the Google block, the instructor note and the staff link as before", () => {
    const html = render({ googleAuthEnabled: true, demoEnabled: false });
    assert.ok(html.includes("Sign in with Google"));
    assert.ok(html.includes(INSTRUCTOR_NOTE));
    assert.ok(html.includes("Staff? Register here"));
    assert.ok(html.includes(">or</span>"), "expected the or divider above the Google button");
  });

  it("still explains a missing Google setup", () => {
    const html = render({ googleAuthEnabled: false, demoEnabled: false });
    assert.ok(html.includes(GOOGLE_OFF_NOTE));
    assert.ok(html.includes(INSTRUCTOR_NOTE));
    assert.ok(html.includes("Staff? Register here"));
  });

  it("shows nothing from the demo", () => {
    const html = render({ googleAuthEnabled: true, demoEnabled: false });
    assert.ok(!html.includes(DEMO_ENTER_STUDENT));
    assert.ok(!html.includes(DEMO_ENTER_INSTRUCTOR));
    assert.ok(!html.includes(DEMO_SIGNIN_NOTE));
  });
});

describe("AuthPageClient with the demo switch on", () => {
  for (const googleAuthEnabled of [true, false]) {
    describe(`and Google sign-in ${googleAuthEnabled ? "on" : "off"}`, () => {
      const html = render({ googleAuthEnabled, demoEnabled: true });

      it("shows the two demo buttons and the demo note", () => {
        assert.ok(html.includes(DEMO_ENTER_STUDENT));
        assert.ok(html.includes(DEMO_ENTER_INSTRUCTOR));
        assert.ok(html.includes(DEMO_SIGNIN_NOTE));
      });

      it("takes the place of the Google block, its divider and the Google setup note", () => {
        assert.ok(!html.includes("Sign in with Google"));
        assert.ok(!html.includes(GOOGLE_OFF_NOTE));
        assert.ok(!html.includes(">or</span>"));
      });

      it("replaces the instructor note and hides the staff link", () => {
        assert.ok(!html.includes(INSTRUCTOR_NOTE));
        assert.ok(!html.includes("Staff? Register here"));
      });

      it("keeps the sign-in form", () => {
        assert.ok(html.includes('aria-label="Sign in"'));
        assert.ok(html.includes("Forgot your password?"));
      });
    });
  }
});
