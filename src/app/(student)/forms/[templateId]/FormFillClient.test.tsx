import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import type { FieldDef } from "@/lib/forms/schema";
import { FieldInput } from "./FormFillClient";

const HELP = "Use the date on your referral letter.";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function render(field: FieldDef): string {
  return renderToString(
    <FieldInput field={field} value={undefined} onChange={() => {}} disabled={false} />,
  );
}

function helpIdIn(html: string): string {
  const match = html.match(new RegExp(`<span id="([^"]+)"[^>]*>${escapeRegExp(HELP)}</span>`));
  assert.ok(match, "help text renders in a span with an id");
  return match[1];
}

// One entry per widget the form builder can produce, with the tag that carries the field's name.
const CASES: { field: FieldDef; control: RegExp }[] = [
  { field: { key: "a", label: "Name", required: false, helpText: HELP, type: "text" }, control: /<input[^>]*type="text"[^>]*>/ },
  { field: { key: "b", label: "Story", required: false, helpText: HELP, type: "longText" }, control: /<textarea[^>]*>/ },
  { field: { key: "c", label: "Hours", required: false, helpText: HELP, type: "number" }, control: /<input[^>]*type="number"[^>]*>/ },
  { field: { key: "d", label: "Referral date", required: false, helpText: HELP, type: "date" }, control: /<input[^>]*type="date"[^>]*>/ },
  { field: { key: "e", label: "County", required: false, helpText: HELP, type: "select", options: ["Kanawha"] }, control: /<select[^>]*>/ },
  { field: { key: "f", label: "Barriers", required: false, helpText: HELP, type: "multiselect", options: ["Childcare"] }, control: /<div[^>]*role="group"[^>]*>/ },
  { field: { key: "g", label: "Agree", required: false, helpText: HELP, type: "checkbox" }, control: /<input[^>]*type="checkbox"[^>]*>/ },
  { field: { key: "h", label: "ID card", required: false, helpText: HELP, type: "attachment" }, control: /<input[^>]*type="file"[^>]*>/ },
];

describe("FieldInput help text", () => {
  for (const { field, control } of CASES) {
    it(`describes the ${field.type} control with the field's help text`, () => {
      const html = render(field);
      const helpId = helpIdIn(html);
      const tag = html.match(control)?.[0];
      assert.ok(tag, `${field.type} control renders`);
      assert.ok(
        tag.includes(`aria-describedby="${helpId}"`),
        `${field.type} control points aria-describedby at the help text: ${tag}`,
      );
    });
  }

  it("adds no aria-describedby when the field has no help text", () => {
    const html = render({ key: "a", label: "Name", required: false, type: "text" });
    assert.ok(!html.includes("aria-describedby"), html);
  });
});
