import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { QuickAppointmentModal, QuickNoteModal, QuickTaskModal } from "./InterventionQueuePanel";

/**
 * The intervention queue's quick task, note, and appointment modals closed on
 * any backdrop tap, threw away what was typed, and had no dialog semantics
 * (HIG review D-27). Each now sits on FormDialog: a native <dialog> labelled
 * by its one heading, with a visible label on every field.
 */

const noop = () => {};

const cases: { name: string; element: ReactElement; title: string; labels: string[] }[] = [
  {
    name: "QuickTaskModal",
    element: <QuickTaskModal studentId="s1" studentName="Sam" onClose={noop} onCreated={noop} />,
    title: "Quick task for Sam",
    labels: ["What needs to be done?", "Due date (optional)"],
  },
  {
    name: "QuickNoteModal",
    element: <QuickNoteModal studentId="s1" studentName="Sam" onClose={noop} onCreated={noop} />,
    title: "Quick note for Sam",
    labels: ["Category", "Note"],
  },
  {
    name: "QuickAppointmentModal",
    element: <QuickAppointmentModal studentId="s1" studentName="Sam" onClose={noop} onCreated={noop} />,
    title: "Schedule appointment with Sam",
    labels: ["Appointment title", "Date and time"],
  },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&");
}

for (const { name, element, title, labels } of cases) {
  describe(name, () => {
    const html = renderToString(element);

    it("is a native dialog labelled by its title heading", () => {
      const dialog = html.match(/<dialog[^>]*>/)?.[0];
      assert.ok(dialog, `expected a <dialog>, got: ${html.slice(0, 200)}`);
      const labelledBy = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
      assert.ok(labelledBy, "expected aria-labelledby on the dialog");
      assert.match(html, new RegExp(`<h2[^>]*id="${escapeRegExp(labelledBy)}"[^>]*>${escapeRegExp(title)}</h2>`));
    });

    it("shows the title once, with no second heading", () => {
      assert.equal(html.split(title).length - 1, 1, "title rendered more than once");
      assert.doesNotMatch(html, /<h3/);
    });

    it("has no click-to-close overlay of its own", () => {
      assert.doesNotMatch(html, /fixed inset-0/);
    });

    it("gives every field a visible label", () => {
      const fields = html.match(/<(input|select|textarea)\b/g) ?? [];
      assert.equal(fields.length, labels.length, "unexpected field count");
      for (const label of labels) {
        assert.match(
          html,
          new RegExp(`<label[^>]*><span[^>]*>${escapeRegExp(label)}</span><(input|select|textarea)\\b`),
          `missing visible label "${label}"`,
        );
      }
    });
  });
}
