import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import GoalsPageClient from "./GoalsPageClient";
import { ariaLabelOf, buttonTags, goal } from "./__tests__/fixtures";

// One of every row kind that carries Edit/Dismiss controls: monthly header,
// weekly under monthly, task under weekly, task directly on monthly, orphan
// weekly, and a loose task with no parent.
const goals = [
  goal("m1", "monthly", "Get my GED"),
  goal("w1", "weekly", "Study three nights", { parentId: "m1" }),
  goal("t1", "task", "Read chapter one", { parentId: "w1" }),
  goal("d1", "task", "Book the test date", { parentId: "m1" }),
  goal("w2", "weekly", "Call the clinic"),
  goal("t2", "task", "Print my resume"),
];

const html = renderToString(<GoalsPageClient initialGoals={goals} initialGoalPlans={[]} />);
const rowControls = buttonTags(html).filter((tag) => /^(Edit|Dismiss) /.test(ariaLabelOf(tag) ?? ""));

describe("GoalsPageClient row controls (F45: reachable on touch)", () => {
  it("never hides Edit/Dismiss behind hover", () => {
    assert.ok(!html.includes("opacity-0"), "found opacity-0 (hover-only reveal) in the goals page markup");
  });

  it("renders Edit and Dismiss for every row kind", () => {
    const edits = rowControls.filter((tag) => ariaLabelOf(tag)!.startsWith("Edit "));
    const dismisses = rowControls.filter((tag) => ariaLabelOf(tag)!.startsWith("Dismiss "));
    assert.ok(edits.length >= 6, `expected >= 6 Edit buttons (one per row kind), found ${edits.length}`);
    assert.equal(dismisses.length, edits.length);
  });

  it("gives every Edit/Dismiss control a 44px target", () => {
    for (const tag of rowControls) {
      assert.ok(tag.includes("min-h-11"), `missing min-h-11: ${tag}`);
      assert.ok(tag.includes("min-w-11"), `missing min-w-11: ${tag}`);
    }
  });
});
