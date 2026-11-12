/**
 * The four instructor actions on a StudentAlert, each a conditional write (C10).
 *
 * Two instructors can have the same queue open. Every write therefore says what state it expects, and Postgres
 * re-checks an UPDATE's WHERE against the latest committed row, so a decision made in another window is never
 * overwritten:
 *
 * - Resolve, dismiss and snooze act only on an alert that is still open, the only state the queue lists. If the
 *   alert already has the requested status, the answer is the saved one and nothing is written, so a second resolve
 *   (a dashboard follow-up, a double tap in two windows) is not an error.
 * - Reopen (the queue's Undo) names the status the earlier action set and the timestamp it wrote. `updatedAt` is not
 *   used: the alert sync and the daily detectors refresh an alert's text, which moves `updatedAt` without anyone
 *   changing the decision. `resolvedAt` and `dismissedAt` are written only by the action that set that status, so a
 *   later resolve or dismiss, by anyone, writes a new one and the Undo no longer matches.
 *
 * Zero rows updated is a conflict: the caller answers 409 and the client reloads the queue.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";

export const ALERT_CHANGED_MESSAGE = "Someone else changed this alert. The list now shows the latest.";

const undoExpectationSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
  at: z.string().datetime(),
});

export const alertIdSchema = z.string().cuid();

export const alertActionSchema = z.discriminatedUnion(
  "action",
  [
    z.object({ action: z.literal("snooze"), hours: z.number().int().min(1).max(168).optional() }),
    z.object({ action: z.literal("resolve") }),
    z.object({ action: z.literal("dismiss") }),
    z.object({ action: z.literal("reopen"), expected: undoExpectationSchema }),
  ],
  { message: "Invalid action. Must be: snooze, resolve, dismiss, or reopen" },
);

export type AlertActionInput = z.infer<typeof alertActionSchema>;
export type AlertAction = AlertActionInput["action"];

/** The alert the route already found and scope-checked. */
export interface AlertTarget {
  id: string;
  studentId: string;
}

export type AlertActionResponse =
  | { status: "resolved"; resolvedAt: string }
  | { status: "dismissed"; dismissedAt: string }
  | { status: "snoozed"; snoozedUntil: string }
  | { status: "open" };

export type AlertActionOutcome =
  /** The write landed. Audit it. */
  | { kind: "changed"; response: AlertActionResponse }
  /** The alert already had the requested status. Nothing was written. */
  | { kind: "unchanged"; response: AlertActionResponse }
  /** The alert is not in the state the request expected. Nothing was written. */
  | { kind: "conflict" };

const DEFAULT_SNOOZE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

interface ForwardWrite {
  status: "resolved" | "dismissed" | "snoozed";
  data: Record<string, Date | string | null>;
  response: AlertActionResponse;
}

function forwardWrite(input: Exclude<AlertActionInput, { action: "reopen" }>, actorId: string, now: Date): ForwardWrite {
  switch (input.action) {
    case "resolve":
      return { status: "resolved", data: { resolvedAt: now }, response: { status: "resolved", resolvedAt: now.toISOString() } };
    case "dismiss":
      return {
        status: "dismissed",
        data: { dismissedAt: now },
        response: { status: "dismissed", dismissedAt: now.toISOString() },
      };
    case "snooze": {
      const snoozedUntil = new Date(now.getTime() + (input.hours ?? DEFAULT_SNOOZE_HOURS) * HOUR_MS);
      return {
        status: "snoozed",
        data: { snoozedUntil, snoozedBy: actorId },
        response: { status: "snoozed", snoozedUntil: snoozedUntil.toISOString() },
      };
    }
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

export async function findAlertTarget(id: string): Promise<AlertTarget | null> {
  return prisma.studentAlert.findUnique({ where: { id }, select: { id: true, studentId: true } });
}

/** What the alert holds now, as the answer a request for `status` would have got. Null when it holds something else. */
async function savedAnswer(alert: AlertTarget, status: ForwardWrite["status"]): Promise<AlertActionResponse | null> {
  const current = await prisma.studentAlert.findUnique({
    where: { id: alert.id },
    select: { status: true, resolvedAt: true, dismissedAt: true, snoozedUntil: true },
  });
  if (!current || current.status !== status) return null;
  if (status === "resolved" && current.resolvedAt) return { status, resolvedAt: current.resolvedAt.toISOString() };
  if (status === "dismissed" && current.dismissedAt) return { status, dismissedAt: current.dismissedAt.toISOString() };
  if (status === "snoozed" && current.snoozedUntil) return { status, snoozedUntil: current.snoozedUntil.toISOString() };
  return null;
}

async function applyForward(
  alert: AlertTarget,
  input: Exclude<AlertActionInput, { action: "reopen" }>,
  actorId: string,
  now: Date,
): Promise<AlertActionOutcome> {
  const write = forwardWrite(input, actorId, now);
  const { count } = await prisma.studentAlert.updateMany({
    where: { id: alert.id, studentId: alert.studentId, status: "open" },
    data: { status: write.status, ...write.data },
  });
  if (count === 1) return { kind: "changed", response: write.response };
  const saved = await savedAnswer(alert, write.status);
  return saved ? { kind: "unchanged", response: saved } : { kind: "conflict" };
}

async function applyReopen(
  alert: AlertTarget,
  expected: z.infer<typeof undoExpectationSchema>,
): Promise<AlertActionOutcome> {
  const at = new Date(expected.at);
  const stamp = expected.status === "resolved" ? { resolvedAt: at } : { dismissedAt: at };
  const { count } = await prisma.studentAlert.updateMany({
    where: { id: alert.id, studentId: alert.studentId, status: expected.status, ...stamp },
    data: { status: "open", snoozedUntil: null, snoozedBy: null, dismissedAt: null, resolvedAt: null },
  });
  return count === 1 ? { kind: "changed", response: { status: "open" } } : { kind: "conflict" };
}

export async function applyAlertAction(
  alert: AlertTarget,
  input: AlertActionInput,
  actorId: string,
  now: Date,
): Promise<AlertActionOutcome> {
  if (input.action === "reopen") return applyReopen(alert, input.expected);
  return applyForward(alert, input, actorId, now);
}

const AUDIT_ACTION: Record<AlertAction, string> = {
  resolve: "teacher.alert.resolved",
  dismiss: "teacher.alert.dismissed",
  snooze: "teacher.alert.snoozed",
  reopen: "teacher.alert.reopened",
};

export interface AlertAuditEvent {
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

/** The audit row for a transition. Actor and alert ids only: no student id, title or summary. */
export function alertAuditEvent(
  alertId: string,
  input: AlertActionInput,
  actor: { id: string; role: string },
): AlertAuditEvent {
  // Every write is conditional, so the status it moved from is known: open, or the one the Undo expected.
  const from = input.action === "reopen" ? input.expected.status : "open";
  const metadata = input.action === "snooze" ? { from, hours: input.hours ?? DEFAULT_SNOOZE_HOURS } : { from };
  return {
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTION[input.action],
    targetType: "student_alert",
    targetId: alertId,
    metadata,
  };
}
