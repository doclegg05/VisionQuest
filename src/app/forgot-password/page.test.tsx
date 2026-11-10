import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { STUDENT_PASSWORD_HINT } from "@/lib/password-policy";
import ForgotPasswordPage from "./page";

/** ForgotPasswordPage calls useRouter(); mirrors WelcomeFlow.test.tsx's helper. */
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

describe("ForgotPasswordPage — classroom recovery questions note", () => {
  it("states the consequence of the lower-security option, not just its category", () => {
    const html = renderToString(withAppRouter(<ForgotPasswordPage />));
    assert.ok(
      html.includes("Anyone who knows the answers could get into your account this way"),
      "expected the consequence to be named, not just 'lower-security option'",
    );
    assert.ok(!html.includes("This is a lower-security option."));
  });
});

describe("ForgotPasswordPage: the new password field", () => {
  const html = renderToString(withAppRouter(<ForgotPasswordPage />));

  it("shows the length rule under the field, where it stays while the student types", () => {
    assert.ok(html.includes(STUDENT_PASSWORD_HINT));
    assert.match(html, /<p[^>]*id="new-password-hint"/);
  });

  it("no longer hides the rule in a placeholder", () => {
    const input = html.match(/<input[^>]*id="new-password"[^>]*>/)?.[0] ?? "";
    assert.ok(input, "the new password input is rendered");
    assert.doesNotMatch(input, /placeholder=/);
  });

  it("lets the student look at the new password", () => {
    assert.match(html, /<button[^>]*aria-controls="new-password"[^>]*>Show<\/button>/);
  });
});
