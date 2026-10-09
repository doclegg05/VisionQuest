import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import GoalsPageClient, { removalConfirmation, sendGoalRemoval } from "./GoalsPageClient";
import { ariaLabelOf, buttonTags, goal } from "./__tests__/fixtures";

// HIG review B-32: "Dismiss" abandoned a goal at once with no way back. Removal
// now hides the goal, offers Undo, and only then sends the request. Removing
// the Big Vision or a goal with steps under it asks first.

const goals = [
  goal("b1", "bhag", "Become a certified welder"),
  goal("m1", "monthly", "Get my GED"),
  goal("w1", "weekly", "Study three nights", { parentId: "m1" }),
  goal("t1", "task", "Read chapter one", { parentId: "w1" }),
  goal("w2", "weekly", "Call the clinic"),
];

const html = renderToString(<GoalsPageClient initialGoals={goals} initialGoalPlans={[]} />);
const labels = buttonTags(html).map(ariaLabelOf);

describe("GoalsPageClient removal controls (B-32)", () => {
  it("labels every removal control Remove, never Dismiss", () => {
    assert.ok(labels.includes("Remove Big Vision"), `labels: ${labels.join(", ")}`);
    for (const kind of ["Monthly", "Weekly", "Task"]) {
      assert.ok(labels.includes(`Remove ${kind}`), `missing Remove ${kind}: ${labels.join(", ")}`);
    }
    assert.ok(!/Dismiss/.test(html), "found Dismiss in the goals page markup");
  });

  it("mounts the undo toast's live region and the confirm dialog", () => {
    assert.match(html, /role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
    assert.match(html, /<dialog[^>]*role="alertdialog"/);
  });

  it("calls the proposed-goal escape hatch Remove too", () => {
    const proposed = renderToString(
      <GoalsPageClient initialGoals={[goal("m9", "monthly", "Sage idea", { status: "proposed" })]} initialGoalPlans={[]} />,
    );
    assert.ok(proposed.includes("You can remove it."), "proposed note should say remove");
    assert.ok(!/Dismiss/.test(proposed));
  });
});

describe("removalConfirmation (B-32)", () => {
  const active = goals;

  it("asks before removing a goal that has steps under it, and says the steps stay", () => {
    const options = removalConfirmation(goal("m1", "monthly", "Get my GED"), active);
    assert.ok(options, "expected a confirmation for a goal with a weekly step");
    assert.equal(options.confirmLabel, "Remove");
    assert.match(options.title, /^Remove .*\?$/);
    assert.match(options.message ?? "", /step under it stays on your board/);
  });

  it("counts every step directly under the goal", () => {
    const options = removalConfirmation(goal("w1", "weekly", "x", { parentId: "m1" }), [
      ...active,
      goal("t2", "task", "Second task", { parentId: "w1" }),
    ]);
    assert.match(options?.message ?? "", /2 steps under it stay on your board/);
  });

  it("asks before removing the Big Vision even with nothing under it", () => {
    const options = removalConfirmation(goal("b1", "bhag", "Become a welder"), active);
    assert.ok(options, "expected a confirmation for the Big Vision");
    assert.equal(options.confirmLabel, "Remove");
    assert.match(options.title, /Big Vision/);
  });

  it("removes a leaf goal without asking; Undo is the safety net", () => {
    assert.equal(removalConfirmation(goal("t1", "task", "Read", { parentId: "w1" }), active), null);
    assert.equal(removalConfirmation(goal("w2", "weekly", "Call the clinic"), active), null);
  });
});

describe("sendGoalRemoval (B-32 commit)", () => {
  afterEach(() => mock.restoreAll());

  it("PATCHes the goal to abandoned with keepalive so it survives a tab close", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ goal: { ...goal("w2", "weekly", "Call"), status: "abandoned" } }), {
        status: 200,
      });
    });

    const updated = await sendGoalRemoval("w2");

    assert.equal(updated.status, "abandoned");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/goals/w2");
    assert.equal(calls[0].init?.method, "PATCH");
    assert.equal(calls[0].init?.keepalive, true);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { status: "abandoned" });
  });

  it("rejects with the server's message so the queue restores the goal and shows the error", async () => {
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "Goal is locked." }), { status: 409 }));
    await assert.rejects(sendGoalRemoval("w2"), /Goal is locked\./);
  });

  it("rejects with a plain fallback when the server gives no message", async () => {
    mock.method(globalThis, "fetch", async () => new Response("oops", { status: 500 }));
    await assert.rejects(sendGoalRemoval("w2"), /Could not remove the goal\./);
  });
});
