import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { ConfirmDialogBody, promptResult, type DialogState } from "./useConfirm";

/**
 * useConfirm replaces the browser's confirm/alert/prompt dialogs, so its own
 * controls must meet the HIG: 44pt buttons, stacked full width on phones, and
 * destructive ink that passes contrast (was white on red-500, 3.76:1; HIG
 * review A-6). prompt() replaces window.prompt for the teacher's "optional note
 * to the student" (D-24) with a labelled text area.
 */

const base: DialogState = {
  title: "Delete template?",
  message: "Student progress tied to it is also removed.",
  confirmLabel: "Delete",
  cancelLabel: "Cancel",
  destructive: true,
};

function render(state: DialogState): string {
  return renderToString(
    <ConfirmDialogBody
      state={state}
      titleId="t"
      messageId="m"
      inputId="i"
      inputValue=""
      onInputChange={() => {}}
      onSettle={() => {}}
    />,
  );
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
}

describe("ConfirmDialogBody", () => {
  it("gives every button a 44pt minimum height", () => {
    const tags = buttons(render(base));
    assert.equal(tags.length, 2);
    for (const tag of tags) assert.match(tag, /min-h-11/);
  });

  it("stacks the buttons full width on phones, confirm on top", () => {
    const html = render(base);
    assert.match(html, /flex-col-reverse[^"]*sm:flex-row/);
    for (const tag of buttons(html)) assert.match(tag, /w-full[^"]*sm:w-auto/);
  });

  it("paints a destructive confirm with the error tokens", () => {
    const confirmButton = buttons(render(base))[1];
    assert.match(confirmButton, /bg-\[var\(--error\)\]/);
    assert.match(confirmButton, /text-\[var\(--on-error\)\]/);
    assert.doesNotMatch(confirmButton, /red-500|text-white/);
  });

  it("renders a labelled text area in prompt mode", () => {
    const html = render({
      ...base,
      destructive: false,
      input: { label: "Note for the student (optional)", placeholder: "What to fix" },
    });
    assert.match(html, /<label[^>]*for="i"[^>]*>Note for the student \(optional\)<\/label>/);
    assert.match(html, /<textarea[^>]*id="i"/);
  });

  it("has no text area outside prompt mode", () => {
    assert.doesNotMatch(render(base), /<textarea/);
  });
});

describe("promptResult", () => {
  it("is null when cancelled", () => {
    assert.equal(promptResult(false, "anything"), null);
  });

  it("is the trimmed text when confirmed, empty allowed", () => {
    assert.equal(promptResult(true, "  fix page 2  "), "fix page 2");
    assert.equal(promptResult(true, "   "), "");
  });
});
