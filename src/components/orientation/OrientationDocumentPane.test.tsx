import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import {
  DocumentReadCheckbox,
  OrientationDocumentPane,
  SignStartButton,
  shouldPromptToOpenDocument,
} from "./OrientationWizard";
import { buildFormDownloadUrl } from "@/lib/spokes/forms";

const URL_FOR_FORM = buildFormDownloadUrl("student-rights", "view");
const TITLE = "Student Rights";
const NOT_OPENED_PROMPT =
  "You have not opened the document yet. Tap Open the document and read it before you sign.";
const DASHES = /[‒–—―]/;

type PaneKind = Parameters<typeof OrientationDocumentPane>[0]["kind"];

function render(props: { needsRedo?: boolean; kind?: PaneKind } = {}): string {
  return renderToString(
    <OrientationDocumentPane url={URL_FOR_FORM} title={TITLE} kind="sign" onOpen={() => {}} {...props} />,
  );
}

function renderCheckbox(checked: boolean, openedDocument: boolean, kind: "sign" | "acknowledge" = "sign"): string {
  return renderToString(
    <DocumentReadCheckbox checked={checked} openedDocument={openedDocument} kind={kind} onChange={() => {}} />,
  );
}

/** Pulls the opening tag that contains `needle`, so attributes can be checked in isolation. */
function tagContaining(html: string, tagName: string, needle: string): string {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, "g")) ?? [];
  const found = tags.find((tag) => tag.includes(needle));
  assert.ok(found, `no <${tagName}> containing ${needle} in: ${html}`);
  return found;
}

/** Visible text with tags removed and entities decoded enough for copy checks. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  assert.ok(match, `no ${name} on ${tag}`);
  return match[1];
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

  it("says where the document opens and what to do after, in plain words", () => {
    const text = textOf(render());
    assert.ok(
      text.includes(
        "It opens on a new page. Read all of it. Then come back to this page to sign. If it downloads instead, open it from your downloads.",
      ),
      text,
    );
    assert.ok(!text.includes("new tab"), text);
  });

  it("mentions the frame below only on md and wider, where the frame shows", () => {
    const html = render();
    const line = tagContaining(html, "p", "md:block");
    assert.match(line, /class="[^"]*\bhidden\b/);
    const after = html.slice(html.indexOf(line));
    assert.ok(after.startsWith(`${line}You can also read it below.`), after.slice(0, 200));
  });

  it("starts with step 1 in the order of the page", () => {
    const text = textOf(render());
    assert.ok(text.includes("1. Open and read the document."), text);
    assert.ok(text.indexOf("1. Open and read") < text.indexOf("Open the document "), text);
  });

  it("ties the helper line to the link and names the document for screen readers", () => {
    const html = render();
    const link = tagContaining(html, "a", "/api/forms/download");
    const describedBy = attr(link, "aria-describedby");
    const helper = tagContaining(html, "p", `id="${describedBy}"`);
    const helperText = html.slice(html.indexOf(helper) + helper.length);
    assert.ok(helperText.startsWith("It opens on a new page."), helperText.slice(0, 80));
    const linkBody = html.slice(html.indexOf(link) + link.length, html.indexOf("</a>", html.indexOf(link)));
    assert.match(linkBody, new RegExp(`<span class="sr-only">[^<]*${TITLE}`));
  });

  it("shows the sent-back line above the link only when the instructor sent the form back", () => {
    const sentBack = "Your instructor asked you to do this form again.";
    assert.ok(!render().includes(sentBack));
    const html = render({ needsRedo: true });
    assert.ok(html.includes(sentBack), html);
    assert.ok(html.indexOf(sentBack) < html.indexOf("<a "), "the line belongs above the link");
  });

  it("uses no dash characters in its copy", () => {
    assert.doesNotMatch(textOf(render({ needsRedo: true })), DASHES);
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

// A UX review found that steps with no signature still told the student to
// sign: the pane and the nudge are shared by sign, acknowledge and read-only
// steps, and on a legal form a careful student then waits for a signature
// box that never comes.
describe("a document step that has no signature", () => {
  it("does not tell the student to sign on an acknowledge step", () => {
    const text = textOf(render({ kind: "acknowledge" }));
    assert.ok(text.includes("Then come back to this page."), text);
    assert.doesNotMatch(text, /\bsign\b/i);
  });

  it("does not tell the student to sign on a read-only step, and does not number a single step", () => {
    const text = textOf(render({ kind: "read-only" }));
    assert.ok(text.includes("Open and read the document."), text);
    assert.doesNotMatch(text, /1\. Open/);
    assert.doesNotMatch(text, /\bsign\b/i);
  });

  it("still tells the student to come back and sign on a sign step", () => {
    const text = textOf(render({ kind: "sign" }));
    assert.ok(text.includes("1. Open and read the document."), text);
    assert.ok(text.includes("Then come back to this page to sign."), text);
  });

  it("nudges with 'before you go on' when there is nothing to sign", () => {
    const text = textOf(renderCheckbox(true, false, "acknowledge"));
    assert.ok(
      text.includes("You have not opened the document yet. Tap Open the document and read it before you go on."),
      text,
    );
    assert.doesNotMatch(text, /\bsign\b/i);
  });
});

describe("the embedded frame", () => {
  // The frame is hidden below md with CSS, which hides it but does not stop a
  // phone fetching the PDF. A lazy frame that is never laid out is not fetched.
  it("loads lazily, so a phone that never shows it does not fetch the document", () => {
    const frame = tagContaining(render(), "iframe", "/api/forms/download");
    assert.equal(attr(frame, "loading"), "lazy");
  });
});

describe("shouldPromptToOpenDocument", () => {
  it("prompts only when the box is ticked and the link was never pressed", () => {
    assert.equal(shouldPromptToOpenDocument({ hasRead: true, openedDocument: false }), true);
    assert.equal(shouldPromptToOpenDocument({ hasRead: true, openedDocument: true }), false);
    assert.equal(shouldPromptToOpenDocument({ hasRead: false, openedDocument: false }), false);
    assert.equal(shouldPromptToOpenDocument({ hasRead: false, openedDocument: true }), false);
  });
});

describe("DocumentReadCheckbox", () => {
  it("leads with step 2 and asks the student to confirm they opened and read it", () => {
    const text = textOf(renderCheckbox(false, false));
    assert.ok(text.includes("2. Tick the box."), text);
    assert.ok(text.includes("I opened and read this document"), text);
    assert.ok(!text.includes("I have read this document"), text);
  });

  it("gives the label row at least 44px and the box 24px", () => {
    const html = renderCheckbox(false, false);
    const label = tagContaining(html, "label", "class=");
    assert.match(label, /class="[^"]*\bmin-h-11\b/);
    const box = tagContaining(html, "input", 'type="checkbox"');
    assert.match(box, /class="[^"]*\bh-6\b/);
    assert.match(box, /class="[^"]*\bw-6\b/);
  });

  it("shows the not-opened prompt on phones only, when ticked before opening", () => {
    const html = renderCheckbox(true, false);
    assert.ok(textOf(html).includes(NOT_OPENED_PROMPT), html);
    const status = tagContaining(html, "p", 'role="status"');
    assert.match(status, /class="[^"]*\bmd:hidden\b/);
  });

  it("stays quiet once the link was pressed or while the box is clear", () => {
    assert.ok(!textOf(renderCheckbox(true, true)).includes(NOT_OPENED_PROMPT));
    assert.ok(!textOf(renderCheckbox(false, false)).includes(NOT_OPENED_PROMPT));
  });

  it("uses no dash characters in its copy", () => {
    assert.doesNotMatch(textOf(renderCheckbox(true, false)), DASHES);
  });
});

describe("SignStartButton", () => {
  it("leads with step 3 before the sign button", () => {
    const html = renderToString(<SignStartButton onClick={() => {}} />);
    const text = textOf(html);
    assert.ok(text.includes("3. Sign."), text);
    assert.ok(text.indexOf("3. Sign.") < text.indexOf("Sign & Continue"), text);
    assert.match(tagContaining(html, "button", "class="), /\bmin-h-11\b/);
  });
});
