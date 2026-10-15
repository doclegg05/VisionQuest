import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import FormUploadButton from "./FormUploadButton";

/**
 * WCAG 2.5.3 Label in Name: a control's accessible name must contain the
 * words a sighted person reads on it. These buttons once carried
 * aria-label="Upload document" over visible text "Re-upload" and
 * "Upload Form", so a voice-control user saying "click Re-upload" got nothing.
 */

function decode(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

function visibleText(inner: string): string {
  // Drop aria-hidden decoration (the paperclip emoji), then strip tags.
  const withoutHidden = inner.replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "");
  return decode(withoutHidden.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function buttons(html: string): Array<{ attrs: string; text: string }> {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1],
    text: visibleText(m[2]),
  }));
}

describe("FormUploadButton accessible names", () => {
  const cases = [
    { status: "pending" as const, label: "Re-upload" },
    { status: "rejected" as const, label: "Re-upload" },
    { status: null, label: "Upload Form" },
  ];

  for (const { status, label } of cases) {
    it(`${status ?? "no submission"}: the button's name contains its visible text "${label}"`, () => {
      const html = renderToString(<FormUploadButton formId="f1" currentStatus={status} />);
      const found = buttons(html);
      assert.equal(found.length, 1, "one upload button per state");
      const [button] = found;
      assert.equal(button.text, label);

      const ariaLabel = /aria-label="([^"]*)"/.exec(button.attrs)?.[1];
      if (ariaLabel !== undefined) {
        assert.ok(
          decode(ariaLabel).toLowerCase().includes(label.toLowerCase()),
          `aria-label "${ariaLabel}" hides the visible text "${label}"`,
        );
      }
    });
  }
});
