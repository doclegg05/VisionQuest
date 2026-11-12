import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { ActionNotice, SUCCESS_CLEARS_AFTER_MS, isTabChange } from "./ActionNotice";

/**
 * The one message an action leaves on the instructor's student page.
 *
 * It sat above the tabs, so a failed Verify far down the Progress tab showed
 * nothing on screen. It is now pinned to the bottom of the viewport, and an
 * error looks like one. It sits where the undo toast sits, so it covers
 * neither the phone tab bar nor the desktop Sage button.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/teacher/student-detail/ActionNotice.tsx"),
  "utf8",
);

/** The undo toast already clears the phone tab bar and the Sage button. The message borrows its offset. */
const UNDO_TOAST = readFileSync(path.join(process.cwd(), "src/components/ui/useUndo.tsx"), "utf8");

const noop = () => {};

/** The class list of the first tag that has all of `needles`. */
function classOf(html: string, ...needles: string[]): string {
  const lists = [...html.matchAll(/class="([^"]*)"/gu)].map((match) => match[1]);
  const found = lists.find((list) => needles.every((needle) => list.split(" ").includes(needle)));
  assert.ok(found, `no element with ${needles.join(" ")} in ${html}`);
  return found;
}

function text(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/&[a-z#0-9]+;/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("ActionNotice: an error", () => {
  const html = renderToString(
    <ActionNotice notice={{ kind: "error", text: "The note was not saved. Try again." }} onDismiss={noop} />,
  );

  it("is announced as an alert", () => {
    assert.match(html, /role="alert"/u);
    assert.doesNotMatch(html, /aria-live="polite"/u);
  });

  it("does not repeat Not saved in front of a sentence that already says it", () => {
    assert.doesNotMatch(text(html), /Not saved:/u);
    assert.equal(text(html).startsWith("The note was not saved. Try again."), true, text(html));
  });

  it("shows the first sentence in bold and the rest plain", () => {
    assert.match(html, /<strong class="font-semibold">The note was not saved\.<\/strong>/u);
    assert.doesNotMatch(html, /<strong[^>]*>[^<]*Try again/u);
  });

  it("is pinned to the bottom of the viewport with the undo toast's offset", () => {
    const phone = UNDO_TOAST.match(/\bbottom-\[calc\([^\]]+\)\]/u)?.[0];
    const desktop = UNDO_TOAST.match(/\bmd:bottom-\d+\b/u)?.[0];
    assert.ok(phone && desktop, "the undo toast's offset was not found in useUndo.tsx");

    const pinned = classOf(html, "fixed").split(" ");
    assert.ok(pinned.includes(phone), `phones need ${phone}: ${pinned.join(" ")}`);
    assert.ok(pinned.includes(desktop), `desktop needs ${desktop}: ${pinned.join(" ")}`);
  });

  it("stays inside the content area on desktop: off the sidebar and off the Sage button", () => {
    const pinned = classOf(html, "fixed").split(" ");
    assert.ok(pinned.includes("justify-center"), pinned.join(" "));

    // The staff layout starts its content 19rem in, to the right of the sidebar.
    const layout = readFileSync(path.join(process.cwd(), "src/app/(teacher)/layout.tsx"), "utf8");
    const contentStart = layout.match(/\bmd:ml-(\[[^\]]+\])/u)?.[1];
    assert.ok(contentStart, "the staff layout no longer offsets its content with md:ml-[...]");
    assert.ok(pinned.includes(`md:left-${contentStart}`), `desktop needs md:left-${contentStart}: ${pinned.join(" ")}`);

    // The Sage button is 3.5rem wide and 1.5rem from the right edge (right-6 w-14): 6rem clears it.
    const nav = readFileSync(path.join(process.cwd(), "src/components/ui/NavBar.tsx"), "utf8");
    assert.match(nav, /fixed bottom-6 right-6 z-50 hidden h-14 w-14/u, "the Sage button moved: check the message still clears it");
    assert.ok(pinned.includes("md:right-24"), `desktop needs md:right-24: ${pinned.join(" ")}`);
  });

  it("leaves a hidden spacer at the end of the page so the last button can scroll clear", () => {
    const spacer = html.match(/<div aria-hidden="true" class="([^"]*)"><\/div>/u);
    assert.ok(spacer, html);
    assert.match(spacer[1], /\bh-\d+\b/u);
    assert.ok(html.indexOf(spacer[0]) < html.indexOf("fixed"), "the spacer comes first, in the page flow");
  });

  it("uses the danger role classes and a warning icon", () => {
    assert.match(html, /\bborder-danger\b/u);
    assert.match(html, /\bbg-danger-soft\b/u);
    assert.match(html, /<svg\b/u);
    assert.match(SOURCE, /WarningCircle/u);
  });

  it("has a Dismiss button at least 44px, named for screen readers", () => {
    const button = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Dismiss(?:(?!<\/button>)[\s\S])*<\/button>/u);
    assert.ok(button, html);
    assert.match(button[0], /\bmin-h-11\b/u);
    assert.match(button[0], /\bmin-w-11\b/u);
    assert.match(button[0], /type="button"/u);
    assert.match(button[0], /aria-label="Dismiss message"/u);
  });

  it("shows only the icon on phones: the word Dismiss appears from the sm width up", () => {
    assert.match(html, /<span class="hidden sm:inline">Dismiss<\/span>/u);
  });

  it("uses no raw palette colors", () => {
    assert.doesNotMatch(SOURCE, /\b(?:bg|text|border)-(?:red|green|blue|yellow|amber|emerald|rose|slate|gray)-\d/u);
  });
});

describe("ActionNotice: a success", () => {
  const html = renderToString(<ActionNotice notice={{ kind: "success", text: "Case note saved." }} onDismiss={noop} />);

  it("is a status, not an alert, with the success classes and a check icon", () => {
    assert.match(html, /role="status"/u);
    assert.doesNotMatch(html, /role="alert"/u);
    assert.match(html, /\bborder-success\b/u);
    assert.match(SOURCE, /CheckCircle/u);
    assert.equal(text(html).startsWith("Case note saved."), true, text(html));
  });

  it("has the spacer too, so a saved line never covers the next button", () => {
    assert.match(html, /<div aria-hidden="true" class="[^"]*\bh-\d+\b[^"]*"><\/div>/u);
  });

  it("clears itself after about six seconds, and only a success does", () => {
    assert.equal(SUCCESS_CLEARS_AFTER_MS, 6000);
    assert.match(SOURCE, /notice\.kind !== "success"\) return/u);
    assert.match(SOURCE, /clearTimeout/u);
  });
});

describe("ActionNotice: nothing to say", () => {
  it("renders nothing, and no spacer", () => {
    assert.equal(renderToString(<ActionNotice notice={null} onDismiss={noop} />), "");
  });
});

describe("isTabChange: what counts as the instructor changing tab", () => {
  it("the first tab put on screen is not a change", () => {
    assert.equal(isTabChange(null, "coach"), false);
  });

  it("the same tab put on screen again is not a change", () => {
    // The page takes its tabs down while a failed reload shows, then puts the same tab back.
    assert.equal(isTabChange("progress", "progress"), false);
  });

  it("another tab is a change", () => {
    assert.equal(isTabChange("coach", "progress"), true);
  });
});
