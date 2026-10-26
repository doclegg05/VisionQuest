import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { SaveErrorBanner } from "./JobCard";

/**
 * UX review WARNING (2026-09-07): the save-error message had no way to
 * dismiss it. Extracted as its own presentational component so the exact
 * markup (dismiss button size, aria-label, message text size) is testable
 * without a DOM — JobCard's own saveError is internal state that only a
 * failed save sets, and this repo's `.test.tsx` files only exercise
 * `renderToString` (no jsdom/RTL to simulate the save-then-fail sequence).
 */
describe("SaveErrorBanner", () => {
  it("shows the message as an alert", () => {
    const html = renderToString(
      <SaveErrorBanner message="This job isn't on your class's board yet." onDismiss={() => {}} />,
    );
    assert.ok(html.includes('role="alert"'));
    assert.ok(html.includes("This job isn&#x27;t on your class&#x27;s board yet."));
  });

  it("reads the message at text-sm, not text-xs", () => {
    const html = renderToString(<SaveErrorBanner message="We couldn't save that job." onDismiss={() => {}} />);
    const messageEl = html.match(/<p[^>]*>We couldn&#x27;t save that job\.<\/p>/);
    assert.ok(messageEl, "expected the message in its own element");
    assert.ok(messageEl![0].includes("text-sm"), `expected text-sm: ${messageEl![0]}`);
    assert.ok(!messageEl![0].includes("text-xs"), `should not still be text-xs: ${messageEl![0]}`);
  });

  it("has a 44px icon-only dismiss button labeled for screen readers", () => {
    const html = renderToString(<SaveErrorBanner message="We couldn't save that job." onDismiss={() => {}} />);
    const button = html.match(/<button[^>]*aria-label="Dismiss error"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(button, "expected a button labeled Dismiss error");
    assert.ok(button![0].includes("p-2.5"), `expected p-2.5 padding for the 44px target: ${button![0]}`);
    const icon = button![0].match(/<svg[^>]*aria-hidden="true"[^>]*>/);
    assert.ok(icon, "expected an aria-hidden icon inside the dismiss button");
  });
});
