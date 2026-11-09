import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";

import VisionBoardPin, { removePinLabel, resizePinLabel, resizeWidthForKey } from "./VisionBoardPin";
import type { VisionBoardItemData } from "./VisionBoard";
import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";

const GOAL_ITEM: VisionBoardItemData = {
  id: "g1",
  type: "goal",
  content: "Get a CDL",
  fileId: null,
  goalId: "goal-1",
  posX: 0,
  posY: 0,
  width: 20,
  rotation: 0,
  color: null,
  pinColor: "blue",
  zIndex: 1,
};

/**
 * HIG review C-47: a remove control names the pin it removes, and the
 * corkboard's drag handles are 44pt targets on touch.
 */

describe("removePinLabel", () => {
  it("names the pin by its kind and text", () => {
    assert.equal(removePinLabel({ type: "note", content: "Finish my GED" }), "Remove note pin: Finish my GED");
    assert.equal(removePinLabel({ type: "goal", content: "Get a CDL" }), "Remove goal pin: Get a CDL");
  });

  it("falls back to the kind when the pin has no text", () => {
    assert.equal(removePinLabel({ type: "image", content: null }), "Remove image pin");
    assert.equal(removePinLabel({ type: "note", content: "   " }), "Remove note pin");
  });

  it("shortens long text and collapses line breaks", () => {
    const label = removePinLabel({ type: "note", content: `First line\n${"word ".repeat(30)}` });
    assert.ok(label.startsWith("Remove note pin: First line word"), label);
    assert.ok(label.endsWith("…"), label);
    assert.ok(label.length <= "Remove note pin: ".length + 41, label);
  });
});

describe("VisionBoardPin remove button", () => {
  // Desktop hides the phone list, so this button is the only way to remove a
  // pin there. It must exist without a mouse hover, for keyboard and VoiceOver.
  it("is in the page before any hover and shows on keyboard focus", () => {
    const html = renderToString(<VisionBoardPin item={GOAL_ITEM} onDelete={() => {}} />);
    const button = html.match(/<button[^>]*aria-label="Remove goal pin: Get a CDL"[^>]*>/)?.[0];
    assert.ok(button, "expected the remove button without hover");
    assert.match(button, /\bfocus-visible:opacity-100\b/);
    assert.match(button, /\bpointer-coarse:opacity-100\b/);
  });
});

describe("VisionBoardPin goal card", () => {
  // The goal card is always light, like the paper notes, so its text cannot
  // follow the theme: dark-theme ink and info text are white.
  const html = renderToString(<VisionBoardPin item={GOAL_ITEM} onDelete={() => {}} />);

  it("keeps the Linked goal label navy in both themes", () => {
    const label = html.match(/<p class="([^"]*)">Linked goal<\/p>/)?.[1];
    assert.ok(label, "expected the Linked goal label");
    assert.match(label, /\btext-brand-dark/);
    assert.doesNotMatch(label, /\btext-info\b/);
  });

  it("keeps the goal text navy in both themes", () => {
    const text = html.match(/<p class="([^"]*)">Get a CDL<\/p>/)?.[1];
    assert.ok(text, "expected the goal text");
    assert.match(text, /\btext-brand-dark/);
    assert.doesNotMatch(text, /--ink-strong/);
  });
});

describe("resizePinLabel", () => {
  it("names the pin the handle resizes", () => {
    assert.equal(resizePinLabel({ type: "goal", content: "Get a CDL" }), "Width of goal pin: Get a CDL");
    assert.equal(resizePinLabel({ type: "image", content: null }), "Width of image pin");
  });
});

/**
 * HIG review C-47, round 2: the resize handle is an adjustable control
 * (ARIA slider), so VoiceOver's swipe up/down and a keyboard's arrow keys
 * both change the width. A <button> cannot carry role="slider".
 */
describe("VisionBoardPin resize handle", () => {
  const renderHandle = () => {
    const html = renderToString(<VisionBoardPin item={GOAL_ITEM} onDelete={() => {}} />);
    const handle = html.match(/<(\w+)[^>]*role="slider"[^>]*>/);
    assert.ok(handle, "expected a slider resize handle");
    return { tag: handle[1], attrs: handle[0] };
  };

  it("is a focusable slider, not a button", () => {
    const { tag, attrs } = renderHandle();
    assert.notEqual(tag, "button");
    assert.match(attrs, /\btabindex="0"/i);
    assert.match(attrs, /\baria-orientation="horizontal"/);
    assert.match(attrs, /\bdata-resize-handle="true"/);
  });

  it("reports the pin's width and limits", () => {
    const { attrs } = renderHandle();
    assert.match(attrs, /\baria-valuemin="16"/);
    assert.match(attrs, /\baria-valuemax="34"/);
    assert.match(attrs, /\baria-valuenow="20"/);
    assert.match(attrs, /\baria-valuetext="20% of board width"/);
  });

  it("names the pin it resizes", () => {
    const { attrs } = renderHandle();
    assert.match(attrs, /\baria-label="Width of goal pin: Get a CDL"/);
  });

  it("does not claim a global shortcut", () => {
    const { attrs } = renderHandle();
    assert.doesNotMatch(attrs, /aria-keyshortcuts/);
  });

  it("is a 44pt target", () => {
    const { attrs } = renderHandle();
    assert.match(attrs, /\bsize-11\b/);
  });
});

describe("resizeWidthForKey", () => {
  const bounds = { min: 16, max: 34 };

  it("widens on ArrowRight and ArrowUp", () => {
    assert.equal(resizeWidthForKey("ArrowRight", 20, bounds), 22);
    assert.equal(resizeWidthForKey("ArrowUp", 20, bounds), 22);
  });

  it("narrows on ArrowLeft and ArrowDown", () => {
    assert.equal(resizeWidthForKey("ArrowLeft", 20, bounds), 18);
    assert.equal(resizeWidthForKey("ArrowDown", 20, bounds), 18);
  });

  it("jumps to the smallest size on Home and the largest on End", () => {
    assert.equal(resizeWidthForKey("Home", 20, bounds), 16);
    assert.equal(resizeWidthForKey("End", 20, bounds), 34);
  });

  it("stays inside the pin's size limits", () => {
    assert.equal(resizeWidthForKey("ArrowRight", 33, bounds), 34);
    assert.equal(resizeWidthForKey("ArrowUp", 33, bounds), 34);
    assert.equal(resizeWidthForKey("ArrowLeft", 17, bounds), 16);
    assert.equal(resizeWidthForKey("ArrowDown", 17, bounds), 16);
  });

  it("ignores other keys", () => {
    assert.equal(resizeWidthForKey("Enter", 20, bounds), null);
    assert.equal(resizeWidthForKey(" ", 20, bounds), null);
    assert.equal(resizeWidthForKey("Tab", 20, bounds), null);
  });
});

describe("sticky note tints keep their text readable", () => {
  const source = readFileSync(new URL("./VisionBoardPin.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const tints = [...source.matchAll(/bg-\[linear-gradient\(rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)];

  // The white gloss sits between the tint and the text. Its class decides which themes show it.
  const glossClass = source.match(/className="([^"]*)(?=[^"]*radial-gradient\(circle_at_top_left,rgba\(255,255,255,0\.38\))[^"]*"/)?.[0] ?? "";
  const glossAlphas = [...glossClass.matchAll(/rgba\(255,255,255,([\d.]+)\)/g)].map((m) => Number(m[1])).slice(0, 2);
  const glossHiddenInDark = /\bdark:(hidden|opacity-0)\b/.test(glossClass);

  it("finds all four tinted notes", () => {
    assert.equal(tints.length, 4);
  });

  it("finds the two gloss layers", () => {
    assert.deepEqual(glossAlphas, [0.38, 0.22]);
  });

  // A color is not a valid background-image layer: `bg-[linear-gradient(...),var(--x)]`
  // is dropped at computed time and the note loses its ground. The ground is its own class.
  it("keeps the ground color out of the gradient and in bg-surface-raised", () => {
    const shells = [...source.matchAll(/shell: "([^"]*rgba[^"]*)"/g)].map((m) => m[1]);
    assert.equal(shells.length, 4);
    for (const shell of shells) {
      assert.doesNotMatch(shell, /bg-\[linear-gradient\([^\]]*var\(/, `color layer inside the gradient: ${shell}`);
      assert.match(shell, /(^|\s)bg-surface-raised(\s|$)/, `no opaque ground: ${shell}`);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    it(`${theme} theme: ink on every tint, gloss included, clears 4.5:1`, () => {
      const ink = cssTokenValue(css, "--ink-strong", theme) as string;
      const ground = cssTokenValue(css, "--surface-raised", theme) as string;
      const glossShown = theme === "light" || !glossHiddenInDark;
      for (const [, r, g, b, a] of tints) {
        let painted = composite({ r: Number(r), g: Number(g), b: Number(b), a: Number(a) }, parseColor(ground));
        // The corner stacks both gloss layers; that is the worst case under the text.
        if (glossShown) {
          for (const alpha of glossAlphas) painted = composite({ r: 255, g: 255, b: 255, a: alpha }, parseColor(painted));
        }
        const ratio = contrastRatio(ink, painted);
        assert.ok(ratio >= 4.5, `rgba(${r},${g},${b},${a}) under ${ink} is ${ratio.toFixed(2)}:1`);
      }
    });
  }
});
