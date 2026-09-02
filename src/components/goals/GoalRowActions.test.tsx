import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { GoalRowActions } from "./GoalRowActions";

function tags(html: string) {
  return html.match(/<button\b[^>]*>/g) ?? [];
}

describe("GoalRowActions (F45: touch-reachable edit/dismiss)", () => {
  const html = renderToString(<GoalRowActions label="Weekly" onEdit={() => {}} onDismiss={() => {}} />);

  it("renders an Edit and a Dismiss button labelled for the row", () => {
    const labels = tags(html).map((tag) => tag.match(/aria-label="([^"]*)"/)?.[1]);
    assert.deepEqual(labels, ["Edit Weekly", "Dismiss Weekly"]);
  });

  it("is visible without hover: no opacity-0 anywhere in the markup", () => {
    assert.ok(!html.includes("opacity-0"), html);
  });

  it("gives both buttons a real 44px touch target", () => {
    for (const tag of tags(html)) {
      assert.ok(tag.includes("min-h-11"), `missing min-h-11: ${tag}`);
      assert.ok(tag.includes("min-w-11"), `missing min-w-11: ${tag}`);
    }
  });
});
