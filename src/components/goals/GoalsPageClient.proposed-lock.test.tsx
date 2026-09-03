import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import GoalsPageClient from "./GoalsPageClient";
import { PROPOSED_TOGGLE_HINT } from "./goal-locks";
import { buttonTags, goal, isDisabled, type TestGoal } from "./__tests__/fixtures";

function render(goals: TestGoal[]) {
  return renderToString(<GoalsPageClient initialGoals={goals} initialGoalPlans={[]} />);
}

function completeToggles(html: string) {
  return buttonTags(html).filter((tag) => tag.includes('aria-label="Mark complete"'));
}

describe("GoalsPageClient proposed-goal toggles (F23 client)", () => {
  it("disables weekly and task toggles under a Sage-proposed monthly goal and shows a hint", () => {
    const html = render([
      goal("m1", "monthly", "Get my GED", { status: "proposed" }),
      goal("w1", "weekly", "Study three nights", { parentId: "m1" }),
      goal("t1", "task", "Read chapter one", { parentId: "w1" }),
    ]);
    const toggles = completeToggles(html);
    assert.equal(toggles.length, 2, `expected a weekly and a task toggle, got ${toggles.length}`);
    for (const tag of toggles) {
      assert.ok(isDisabled(tag), `toggle should be disabled under a proposed goal: ${tag}`);
    }
    assert.ok(html.includes(PROPOSED_TOGGLE_HINT), "expected the plain-language hint next to the locked toggles");
  });

  it("keeps weekly and task toggles enabled under a confirmed monthly goal", () => {
    const html = render([
      goal("m1", "monthly", "Get my GED", { status: "confirmed" }),
      goal("w1", "weekly", "Study three nights", { parentId: "m1" }),
      goal("t1", "task", "Read chapter one", { parentId: "w1" }),
    ]);
    const toggles = completeToggles(html);
    assert.equal(toggles.length, 2);
    for (const tag of toggles) {
      assert.ok(!isDisabled(tag), `toggle should be enabled under a confirmed goal: ${tag}`);
    }
    assert.ok(!html.includes(PROPOSED_TOGGLE_HINT), "hint must not show when nothing is locked");
  });

  it("disables the toggle of a proposed weekly goal that has no monthly parent", () => {
    const html = render([goal("w1", "weekly", "Call the clinic", { status: "proposed" })]);
    const toggles = completeToggles(html);
    assert.equal(toggles.length, 1);
    assert.ok(isDisabled(toggles[0]), toggles[0]);
    assert.ok(html.includes(PROPOSED_TOGGLE_HINT));
  });
});
