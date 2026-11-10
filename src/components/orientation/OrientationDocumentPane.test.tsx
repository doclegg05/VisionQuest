import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { OrientationDocumentPane } from "./OrientationWizard";
import { buildFormDownloadUrl } from "@/lib/spokes/forms";

const URL_FOR_FORM = buildFormDownloadUrl("student-rights", "view");
const TITLE = "Student Rights";

function render(): string {
  return renderToString(<OrientationDocumentPane url={URL_FOR_FORM} title={TITLE} />);
}

/** Pulls the opening tag that contains `needle`, so attributes can be checked in isolation. */
function tagContaining(html: string, tagName: string, needle: string): string {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, "g")) ?? [];
  const found = tags.find((tag) => tag.includes(needle));
  assert.ok(found, `no <${tagName}> containing ${needle} in: ${html}`);
  return found;
}

describe("OrientationDocumentPane", () => {
  it("offers an Open the document link that points at the same address as the frame", () => {
    const html = render();
    const link = tagContaining(html, "a", "/api/forms/download");
    // renderToString escapes & as &amp; inside attribute values.
    assert.ok(link.includes(`href="${URL_FOR_FORM.replace(/&/g, "&amp;")}"`), link);
    assert.ok(html.includes("Open the document"), "the link needs a visible label");
    const frame = tagContaining(html, "iframe", "/api/forms/download");
    assert.ok(frame.includes(`src="${URL_FOR_FORM.replace(/&/g, "&amp;")}"`), frame);
  });

  it("opens the link in a new tab without leaking the opener", () => {
    const link = tagContaining(render(), "a", "/api/forms/download");
    assert.ok(link.includes('target="_blank"'), link);
    assert.ok(link.includes('rel="noopener noreferrer"'), link);
  });

  it("makes the link a touch target of at least 44px", () => {
    const link = tagContaining(render(), "a", "/api/forms/download");
    assert.match(link, /class="[^"]*\bmin-h-11\b/);
  });

  it("tells the student to come back and sign, in plain words", () => {
    const html = render();
    assert.ok(html.includes("It opens in a new tab. Come back here to sign."), html);
  });

  it("hides the embedded frame below the md breakpoint with CSS alone", () => {
    const frame = tagContaining(render(), "iframe", "/api/forms/download");
    assert.match(frame, /class="[^"]*\bhidden\b/);
    assert.match(frame, /class="[^"]*\bmd:block\b/);
  });

  it("keeps the frame address and title so large screens still show the document", () => {
    const frame = tagContaining(render(), "iframe", "/api/forms/download");
    assert.ok(frame.includes(`title="${TITLE}"`), frame);
  });
});
