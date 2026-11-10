import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import ForgotPasswordPage from "@/app/forgot-password/page";
import { LOGIN_FIELD_LABEL } from "./login-label";

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

function labelText(html: string, forId: string): string | null {
  const match = new RegExp(`<label for="${forId}"[^>]*>([^<]*)</label>`).exec(html);
  return match ? match[1].trim() : null;
}

describe("shared login field label", () => {
  it("is the sign-in page's wording, unchanged", () => {
    assert.equal(LOGIN_FIELD_LABEL, "Username or Email");
  });

  it("names the recovery page's classroom-questions field", () => {
    const html = renderToString(withAppRouter(<ForgotPasswordPage />));
    assert.equal(labelText(html, "question-login"), LOGIN_FIELD_LABEL);
  });

  it("drops the old 'Email or Student ID' wording from the recovery page", () => {
    const html = renderToString(withAppRouter(<ForgotPasswordPage />));
    assert.ok(!html.includes("Email or Student ID"));
  });
});

describe("recovery page source", () => {
  // The "Email link" tab is not rendered on first load, so read the file to
  // pin that its field uses the shared label too.
  const source = readFileSync(path.join(process.cwd(), "src/app/forgot-password/page.tsx"), "utf8");

  it("uses the shared constant for both login fields", () => {
    assert.equal(source.split("{LOGIN_FIELD_LABEL}").length - 1, 2);
    assert.ok(!source.includes("Email or Student ID"));
  });
});
