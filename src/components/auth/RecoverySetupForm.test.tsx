import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import RecoverySetupForm from "./RecoverySetupForm";

/**
 * RecoverySetupForm calls useRouter() (for the post-save redirect), and
 * next/navigation's hook throws outside an app-router context — mirrors the
 * withAppRouter helper in WelcomeFlow.test.tsx.
 */
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

describe("RecoverySetupForm", () => {
  it("names the consequence of weak recovery answers, not just the category", () => {
    const html = renderToString(withAppRouter(<RecoverySetupForm redirectTo="/dashboard" />));
    assert.ok(
      html.includes("Anyone who knows your answers could get into your account"),
      "expected the plain-language stakes sentence",
    );
    assert.ok(html.includes("Pick answers only you know"));
  });

  it("still asks all three security questions", () => {
    const html = renderToString(withAppRouter(<RecoverySetupForm redirectTo="/dashboard" />));
    assert.match(html, /<input[^>]*id="security-question-/);
  });
});
