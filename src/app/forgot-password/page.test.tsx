import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

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
