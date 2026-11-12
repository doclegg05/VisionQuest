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

  it("reads a 409 as an alert already handled", async () => {
    const outcome = await closeLinkedAlert("a1", async () => {
      throw new ApiClientError(409, "This alert changed. The list now shows the latest.");
    });
    assert.equal(outcome, "already-handled");
  });

  it("reads any other failure as an alert still open, never as a failed save", async () => {
    const outcome = await closeLinkedAlert(
      "a1",
      async () => {
        throw new ApiClientError(500, "Server error");
      },
      () => {},
    );
    assert.equal(outcome, "not-closed");
  });

  // A failed close is not shown as a failure, so the log is its only trace. It carries the status or the error
  // class, never the alert id or anything the server said.
  it("logs a failed close with its status only", async () => {
    const logged: unknown[][] = [];
    await closeLinkedAlert(
      "alert-secret-id",
      async () => {
        throw new ApiClientError(500, "Server error about alert-secret-id");
      },
      (...args) => logged.push(args),
    );
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], { status: 500 });
    assert.doesNotMatch(JSON.stringify(logged), /alert-secret-id/);
  });

  it("logs a network failure with its error class only", async () => {
    const logged: unknown[][] = [];
    await closeLinkedAlert(
      "alert-secret-id",
      async () => {
        throw new TypeError("Failed to fetch alert-secret-id");
      },
      (...args) => logged.push(args),
    );
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], { name: "TypeError" });
    assert.doesNotMatch(JSON.stringify(logged), /alert-secret-id/);
  });

  it("logs nothing when the alert was already handled", async () => {
    const logged: unknown[][] = [];
    await closeLinkedAlert(
      "a1",
      async () => {
        throw new ApiClientError(409, "This alert changed.");
      },
      (...args) => logged.push(args),
    );
    assert.equal(logged.length, 0);
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
  // The route answers 409 for an alert another instructor closed, a snoozed one, and one the sync resolved, so the
  // words claim none of those in particular.
  it("says the alert was already handled as a success, for every follow-up", () => {
    for (const action of ACTIONS) {
      const message = followUpMessage(action, "already-handled");
      assert.equal(message.tone, "success");
      assert.match(message.text, /The alert was already dealt with\.$/);
      assert.doesNotMatch(message.text, /could not|changed|closed|someone/i);
    }
    assert.equal(followUpMessage({ kind: "task" }, "already-handled").text, "Task saved. The alert was already dealt with.");
    assert.equal(
      followUpMessage({ kind: "form", status: "approved" }, "already-handled").text,
      "Form approved. The alert was already dealt with.",
    );
    assert.equal(
      followUpMessage({ kind: "form", status: "rejected" }, "already-handled").text,
      "Form returned. The alert was already dealt with.",
    );
    assert.equal(
      followUpMessage({ kind: "assign", title: "Resume basics" }, "already-handled").text,
      '"Resume basics" assigned. The alert was already dealt with.',
    );
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
      for (const outcome of ["resolved", "already-handled", "not-closed", "no-alert"] as const) {
        assert.doesNotMatch(followUpMessage(action, outcome).text, /[–—]| - /);
      }
    }
  });
});
