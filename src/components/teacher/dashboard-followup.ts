/**
 * The last step of a dashboard follow-up: after its task, form review or resource has saved, close the queue alert
 * it came from. The save has landed by then, so this step never throws and its answer is never a failure that would
 * invite a second task. A 409 means the alert was already closed, by another instructor or by the alert sync.
 */
import { ApiClientError } from "@/lib/api";

export type LinkedAlertOutcome = "resolved" | "already-closed" | "not-closed" | "no-alert";

export type FollowUpAction =
  | { kind: "task" }
  | { kind: "form"; status: "approved" | "rejected" }
  | { kind: "assign"; title: string };

export interface FollowUpMessage {
  tone: "success" | "error";
  text: string;
}

type Patch = (url: string, body: unknown) => Promise<unknown>;

export async function closeLinkedAlert(alertId: string | null | undefined, patch: Patch): Promise<LinkedAlertOutcome> {
  if (!alertId) return "no-alert";
  try {
    await patch(`/api/teacher/alerts/${encodeURIComponent(alertId)}`, { action: "resolve" });
    return "resolved";
  } catch (error: unknown) {
    if (error instanceof ApiClientError && error.status === 409) return "already-closed";
    return "not-closed";
  }
}

/** What was saved, as the start of the message. */
function savedText(action: FollowUpAction): string {
  switch (action.kind) {
    case "task":
      return "Task saved.";
    case "form":
      return action.status === "approved" ? "Form approved." : "Form returned.";
    case "assign":
      return `"${action.title}" assigned.`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** The wording these follow-ups used before C11b, kept for the case where the alert closed. */
function resolvedText(action: FollowUpAction): string {
  switch (action.kind) {
    case "task":
      return "Follow-up task created and queue item resolved.";
    case "form":
      return action.status === "approved" ? "Form approved and queue item resolved." : "Form returned and queue item resolved.";
    case "assign":
      return `"${action.title}" assigned and queue item resolved.`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function followUpMessage(action: FollowUpAction, outcome: LinkedAlertOutcome): FollowUpMessage {
  const saved = savedText(action);
  switch (outcome) {
    case "resolved":
      return { tone: "success", text: resolvedText(action) };
    case "already-closed":
      return { tone: "success", text: `${saved} Someone else already closed the alert.` };
    case "not-closed":
      // The save worked; only the alert is still open, so the instructor closes it rather than saving again.
      return { tone: "error", text: `${saved} Could not close the alert. Close it from the queue.` };
    case "no-alert":
      return { tone: "success", text: saved };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}
