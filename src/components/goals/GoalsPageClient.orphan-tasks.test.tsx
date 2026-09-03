import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import GoalsPageClient from "./GoalsPageClient";
import { goal, type TestGoal } from "./__tests__/fixtures";

function render(goals: TestGoal[]) {
  return renderToString(<GoalsPageClient initialGoals={goals} initialGoalPlans={[]} />);
}

describe("GoalsPageClient orphan tasks (F24: counted but never rendered)", () => {
  it("renders tasks nested under a weekly goal that has no monthly parent", () => {
    const html = render([
      goal("w1", "weekly", "Call the clinic"),
      goal("t1", "task", "Find the phone number", { parentId: "w1" }),
    ]);
    assert.ok(html.includes("Call the clinic"));
    assert.ok(html.includes("Find the phone number"), "task under an orphan weekly must render");
  });

  it("renders a task whose parent was abandoned, under an Unassigned tasks group", () => {
    const html = render([
      goal("m1", "monthly", "Get my GED"),
      goal("w1", "weekly", "Study three nights", { parentId: "m1", status: "abandoned" }),
      goal("t1", "task", "Read chapter one", { parentId: "w1" }),
    ]);
    assert.ok(html.includes("Read chapter one"), "task under an abandoned weekly must still render");
    assert.ok(html.includes("Unassigned tasks"), "expected the Unassigned tasks group");
  });

  it("renders a task attached directly to a monthly goal inside that card", () => {
    const html = render([
      goal("m1", "monthly", "Get my GED"),
      goal("t1", "task", "Book the test date", { parentId: "m1" }),
    ]);
    assert.ok(html.includes("Book the test date"), "direct task on a monthly goal must render");
  });

  it("renders a task with no parent at all", () => {
    const html = render([goal("t1", "task", "Print my resume")]);
    assert.ok(html.includes("Print my resume"));
    assert.ok(html.includes("Unassigned tasks"));
  });

  it("hides the Unassigned tasks group when every task has a live parent", () => {
    const html = render([
      goal("m1", "monthly", "Get my GED"),
      goal("w1", "weekly", "Study three nights", { parentId: "m1" }),
      goal("t1", "task", "Read chapter one", { parentId: "w1" }),
    ]);
    assert.ok(!html.includes("Unassigned tasks"));
  });
});
