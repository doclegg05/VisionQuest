import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import Page from "./page";
import { SAGE_NOTICE_SECTIONS, SAGE_NOTICE_TITLE } from "@/lib/about-sage/notice";

// The full Sage notice, public at /about-sage. It reads no session, so a
// student can read it before signing in.

const html = renderToString(<Page />);

/** How renderToString writes quote marks in text. */
function asHtml(text: string): string {
  return text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
}

describe("/about-sage notice page", () => {
  it("has one page heading", () => {
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, new RegExp(`<h1[^>]*>${SAGE_NOTICE_TITLE}</h1>`));
  });

  it("has a heading for every section, in order", () => {
    const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
    assert.deepEqual(headings, SAGE_NOTICE_SECTIONS.map((section) => section.heading));
  });

  it("shows every sentence of the notice", () => {
    const missing = SAGE_NOTICE_SECTIONS.flatMap((s) => s.sentences).filter(
      (sentence) => !html.includes(asHtml(sentence)),
    );
    assert.deepEqual(missing, []);
  });

  it("links back to the sign-in page", () => {
    assert.match(html, /<a[^>]*href="\/"[^>]*>/);
  });
});
