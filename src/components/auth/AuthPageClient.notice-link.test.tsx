import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import AuthPageClient from "./AuthPageClient";
import { SAGE_NOTICE_LINK_LABEL, SAGE_NOTICE_PATH } from "@/lib/about-sage/notice";

// H6: the sign-in page links to the Sage notice, which needs no sign-in. The
// link goes below the form, so the form still comes first on phones.

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

function render(props: { googleAuthEnabled: boolean; demoEnabled: boolean }): string {
  return renderToString(
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      <AuthPageClient {...props} />
    </AppRouterContext.Provider>,
  );
}

const LINK = new RegExp(`<a[^>]*href="${SAGE_NOTICE_PATH}"[^>]*>${SAGE_NOTICE_LINK_LABEL}</a>`);

describe("sign-in page link to the Sage notice", () => {
  for (const demoEnabled of [false, true]) {
    it(`shows the link below the sign-in form (demo ${demoEnabled ? "on" : "off"})`, () => {
      const html = render({ googleAuthEnabled: false, demoEnabled });

      assert.match(html, LINK);
      const formEnd = html.indexOf("</form>");
      assert.ok(formEnd > 0, "the sign-in form renders");
      assert.ok(html.search(LINK) > formEnd, "the link comes after the form");
    });
  }

  it("gives the link a touch target of at least 44px", () => {
    const tag = /<a[^>]*href="\/about-sage"[^>]*>/.exec(render({ googleAuthEnabled: false, demoEnabled: false }))?.[0] ?? "";
    assert.match(tag, /\bmin-h-11\b/);
  });
});
