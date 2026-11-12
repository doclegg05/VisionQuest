/**
 * A dashboard follow-up saves its task, form review or resource first, then closes the queue alert it came from. The
 * save has landed by then, so nothing after it may read as a failure that invites a second task.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiClientError } from "@/lib/api";
import { closeLinkedAlert, followUpMessage, type FollowUpAction } from "./dashboard-followup";

const ACTIONS: FollowUpAction[] = [
  { kind: "task" },
  { kind: "form", status: "approved" },
  { kind: "form", status: "rejected" },
  { kind: "assign", title: "Resume basics" },
];

describe("closeLinkedAlert", () => {
  it("resolves the alert when there is one", async () => {
    const calls: Array<[string, unknown]> = [];
    const outcome = await closeLinkedAlert("a1", async (url, body) => {
      calls.push([url, body]);
    });
    assert.equal(outcome, "resolved");
    assert.deepEqual(calls, [["/api/teacher/alerts/a1", { action: "resolve" }]]);
  });

  it("reads a 409 as an alert someone already closed", async () => {
    const outcome = await closeLinkedAlert("a1", async () => {
      throw new ApiClientError(409, "This alert changed. The list now shows the latest.");
    });
    assert.equal(outcome, "already-closed");
  });

  it("reads any other failure as an alert still open, never as a failed save", async () => {
    const outcome = await closeLinkedAlert("a1", async () => {
      throw new ApiClientError(500, "Server error");
    });
    assert.equal(outcome, "not-closed");
  });

  it("sends nothing when the follow-up has no alert", async () => {
    let sent = false;
    const outcome = await closeLinkedAlert(null, async () => {
      sent = true;
    });
    assert.equal(outcome, "no-alert");
    assert.equal(sent, false);
  });
});

describe("followUpMessage", () => {
  it("says the alert was already closed as a success, for every follow-up", () => {
    for (const action of ACTIONS) {
      const message = followUpMessage(action, "already-closed");
      assert.equal(message.tone, "success");
      assert.match(message.text, /Someone else already closed the alert\.$/);
      assert.doesNotMatch(message.text, /could not|changed/i);
    }
    assert.equal(followUpMessage({ kind: "task" }, "already-closed").text, "Task saved. Someone else already closed the alert.");
  });

  it("says the save worked when the alert could not be closed", () => {
    for (const action of ACTIONS) {
      const message = followUpMessage(action, "not-closed");
      assert.equal(message.tone, "error");
      assert.match(message.text, /Could not close the alert\. Close it from the queue\.$/);
    }
    assert.equal(
      followUpMessage({ kind: "task" }, "not-closed").text,
      "Task saved. Could not close the alert. Close it from the queue.",
    );
  });

  it("keeps the saved and resolved wording", () => {
    assert.equal(followUpMessage({ kind: "task" }, "resolved").text, "Follow-up task created and queue item resolved.");
    assert.equal(
      followUpMessage({ kind: "form", status: "approved" }, "resolved").text,
      "Form approved and queue item resolved.",
    );
    assert.equal(
      followUpMessage({ kind: "assign", title: "Resume basics" }, "resolved").text,
      '"Resume basics" assigned and queue item resolved.',
    );
  });

  it("claims no resolved queue item when there was no alert", () => {
    for (const action of ACTIONS) {
      assert.doesNotMatch(followUpMessage(action, "no-alert").text, /queue|alert/);
    }
  });

  it("uses no dashes in what an instructor reads", () => {
    for (const action of ACTIONS) {
      for (const outcome of ["resolved", "already-closed", "not-closed", "no-alert"] as const) {
        assert.doesNotMatch(followUpMessage(action, outcome).text, /[–—]| - /);
      }
    }
  });
});
