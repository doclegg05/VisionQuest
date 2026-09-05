import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";
import { ALLOWED_COLUMNS } from "@/lib/connect/workforce-batch";

import { BatchWorkforceButton } from "./BatchWorkforceButton";

/**
 * The WorkForce WV export's confirm flow (UX review CRITICAL #1).
 *
 * The bug this replaced: the console rendered a bare
 * `<a href="/api/teacher/connect/batch-workforce-wv">`. One tap on a teacher's
 * phone produced an audited export of TANF students' names, with no preview,
 * no confirmation, and copy that said "send" when the route only downloads a
 * file the instructor still has to relay by hand.
 *
 * The first test is the red-baseline for that: the page must contain no direct
 * href to the export route. It is asserted on the page SOURCE, because a link
 * that renders correctly is exactly the thing that was wrong.
 */

const PAGE = readFileSync(
  path.join(process.cwd(), "src/app/(teacher)/teacher/connect/page.tsx"),
  "utf8",
);
const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/teacher/connect/BatchWorkforceButton.tsx"),
  "utf8",
);

const EXPORT_ROUTE = "/api/teacher/connect/batch-workforce-wv";

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&[a-z#0-9]+;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function render() {
  return renderToString(
    <BatchWorkforceButton classes={[{ id: "class-1", name: "SPOKES Fall 2026" }]} />,
  );
}

describe("the export cannot be triggered by one tap", () => {
  it("the console page has no direct link to the export route", () => {
    // The exact shape of the original bug.
    assert.ok(
      !PAGE.includes(`href="${EXPORT_ROUTE}"`),
      "a bare href exports a file of student names on a single tap, with no preview",
    );
    assert.ok(!/<a[^>]*batch-workforce-wv/u.test(PAGE), PAGE);
  });

  it("the component itself renders no anchor to the export route either", () => {
    const html = render();
    assert.ok(!html.includes(`href="${EXPORT_ROUTE}"`), html);
  });

  it("asks the preview endpoint first, and only POSTs on confirm", () => {
    assert.ok(SOURCE.includes(`${EXPORT_ROUTE}/preview?classId=`), "the preview comes first");
    assert.ok(
      SOURCE.includes('method: "POST"'),
      "the download is a POST so a cross-site GET cannot fire it",
    );
    const previewAt = SOURCE.indexOf("loadPreview");
    const confirmAt = SOURCE.indexOf("confirmDownload");
    assert.ok(previewAt > -1 && confirmAt > previewAt, "preview is declared before confirm");
  });

  it("renders no confirm control until a preview has been loaded", () => {
    const html = render();
    assert.ok(!html.includes("Yes, download the file"), "nothing to confirm before the preview");
  });
});

describe("the trigger's copy", () => {
  it("says download, not send", () => {
    const text = stripTags(render());
    assert.ok(
      text.includes("Download this week's ready students") ||
        text.includes("Download this week"),
      text,
    );
  });

  it("says plainly that the instructor still has to send it", () => {
    const text = stripTags(render());
    assert.ok(text.includes("Nothing is sent for you."), text);
    assert.ok(text.includes("email it to your WorkForce WV contact"), text);
  });

  it("says the file only holds ready, consented students", () => {
    const text = stripTags(render());
    assert.ok(text.includes("ready for work"), text);
    assert.ok(text.includes("said yes to being sent to employers"), text);
  });

  it("reads at grade 6", () => {
    const text = stripTags(render());
    const readability = assessReadability(text, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(readability.withinTarget, `reads at grade ${readability.grade}: ${text}`);
  });

  it("keeps a 44px target on the class picker and the trigger", () => {
    const html = render();
    assert.ok((html.match(/min-h-\[44px\]/gu) ?? []).length >= 2, html);
  });

  it("renders nothing at all when the instructor has no classes", () => {
    const html = renderToString(<BatchWorkforceButton classes={[]} />);
    assert.equal(html, "", "there is no program-wide export to offer");
  });
});

describe("the preview's contract", () => {
  it("renders the field list the endpoint returns, not a copy of it", () => {
    // The component must not hold its own list of columns: a second copy is
    // how a confirm dialog starts lying about what the file contains.
    for (const column of ALLOWED_COLUMNS) {
      assert.ok(
        !SOURCE.includes(`"${column}"`),
        `the component hardcodes the "${column}" column instead of showing the server's list`,
      );
    }
    assert.ok(SOURCE.includes("preview.fields.join"), SOURCE.slice(0, 0));
  });

  it("shows both exclusion reasons separately", () => {
    assert.ok(SOURCE.includes("excludedNotReady"), SOURCE.slice(0, 0));
    assert.ok(SOURCE.includes("excludedNoConsent"), SOURCE.slice(0, 0));
  });
});
