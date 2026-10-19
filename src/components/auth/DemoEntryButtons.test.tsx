import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { DEMO_SIGNIN_NOTE } from "@/lib/demo/copy";
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

  it("offers one button to try the demo as a student and one as an instructor", () => {
    assert.equal(buttonTags(html).length, 2);
    assert.ok(html.includes(">Try the demo as a student</button>"));
    assert.ok(html.includes(">Try the demo as an instructor</button>"));
  });

  it("says it is a demo before the choice, once, above both buttons", () => {
    const note = html.indexOf(DEMO_SIGNIN_NOTE);
    assert.ok(note >= 0, "expected the demo note");
    assert.equal(html.split(DEMO_SIGNIN_NOTE).length - 1, 1);
    assert.ok(note < html.indexOf("<button"), "expected the note above the first button");
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

  it("has one status region that is always there, and it starts empty", () => {
    assert.equal(html.split('role="status"').length - 1, 1);
    assert.ok(html.includes('<div role="status" aria-live="polite"></div>'));
  });

  it("reserves the Continue as slot from the first render, empty and 44px tall, above the buttons", () => {
    const slot = html.match(/<div class="[^"]*\bmin-h-11\b[^"]*"><\/div>/);
    assert.ok(slot, "expected an empty min-h-11 slot");
    assert.ok((slot.index ?? 0) < html.indexOf("<button"), "expected the slot above the first button");
  });

  it("shows no Continue as link before the session check has run", () => {
    assert.doesNotMatch(html, /Continue as/);
  });

  it("shows no starting text or error before anything is pressed", () => {
    assert.doesNotMatch(html, /Starting the demo/);
    assert.doesNotMatch(html, /bg-danger-soft/);
  });
});
