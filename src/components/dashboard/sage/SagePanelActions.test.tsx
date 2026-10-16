import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

// useRouter throws outside a mounted App Router; the buttons only call
// router.refresh() after a click, which renderToString never reaches.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});

// Imported dynamically in before(), AFTER mock.module has registered: a
// static import is hoisted and would bind the real next/navigation.
let SagePanelActions: typeof import("./SagePanelActions").SagePanelActions;

before(async () => {
  ({ SagePanelActions } = await import("./SagePanelActions"));
});

interface RenderedButton {
  visibleText: string;
  ariaLabel: string | null;
}

function buttons(html: string): RenderedButton[] {
  return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attrs, text]) => ({
    visibleText: text.trim(),
    ariaLabel: /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? null,
  }));
}

describe("SagePanelActions", () => {
  it("renders the Refresh and Hide for today buttons", () => {
    const html = renderToString(<SagePanelActions panelId="panel-1" />);
    assert.deepEqual(
      buttons(html).map((b) => b.visibleText),
      ["Refresh", "Hide for today"],
    );
  });

  // WCAG 2.5.3 Label in Name: a Voice Control user says the words on the
  // button. An aria-label that replaces those words makes "tap Refresh" miss.
  it("gives each button an accessible name that contains its visible words", () => {
    const html = renderToString(<SagePanelActions panelId="panel-1" />);
    for (const button of buttons(html)) {
      if (button.ariaLabel === null) continue;
      assert.ok(
        button.ariaLabel.toLowerCase().includes(button.visibleText.toLowerCase()),
        `"${button.visibleText}" is announced as "${button.ariaLabel}"`,
      );
    }
  });
});
