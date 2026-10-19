import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { DEMO_ENTER_INSTRUCTOR, DEMO_ENTER_STUDENT } from "@/lib/demo/copy";
import { DemoEntryButtons } from "./DemoEntryButtons";

/** The buttons call useRouter(), which throws outside an app-router context. */
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

/** The opening tags of every <button> in the markup. */
function buttonTags(html: string): string[] {
  return html.match(/<button\b[^>]*>/g) ?? [];
}

describe("DemoEntryButtons (first render)", () => {
  const html = renderToString(withAppRouter(<DemoEntryButtons />));

  it("offers one button to enter as a student and one as an instructor", () => {
    assert.equal(buttonTags(html).length, 2);
    assert.ok(html.includes(DEMO_ENTER_STUDENT));
    assert.ok(html.includes(DEMO_ENTER_INSTRUCTOR));
  });

  it("styles both buttons like the sign-in form button, with a 44px touch target", () => {
    for (const tag of buttonTags(html)) {
      assert.match(tag, /class="[^"]*\bprimary-button\b/);
      assert.match(tag, /class="[^"]*\bw-full\b/);
      assert.match(tag, /class="[^"]*\bmin-h-11\b/);
    }
  });

  it("makes the buttons plain buttons, so they never submit the password form", () => {
    for (const tag of buttonTags(html)) {
      assert.match(tag, /type="button"/);
    }
  });

  it("starts with both buttons enabled", () => {
    for (const tag of buttonTags(html)) {
      // The class list has disabled: variants, so look for the attribute itself.
      assert.doesNotMatch(tag, /\sdisabled(?:=|\s|>)/);
    }
  });

  it("reserves a polite live region for messages, and it starts empty", () => {
    assert.match(html, /<p[^>]*aria-live="polite"[^>]*><\/p>/);
  });

  it("shows no Continue as link before the session check has run", () => {
    assert.doesNotMatch(html, /Continue as/);
  });
});
