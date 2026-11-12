import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, conflict, notFound } from "@/lib/api-error";
import { tryLogAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { parseBody } from "@/lib/schemas";
import {
  ALERT_CHANGED_MESSAGE,
  alertActionSchema,
  alertAuditEvent,
  alertIdSchema,
  applyAlertAction,
  findAlertTarget,
} from "@/lib/teacher/alert-actions";

/**
 * PATCH /api/teacher/alerts/:id
 *
 * Teacher actions on alerts:
 * - action: "snooze"  + hours (1-168): hide the alert until the snooze expires
 * - action: "resolve": mark it resolved
 * - action: "dismiss": soft-delete (won't reappear on resync)
 * - action: "reopen"  + expected { status, at }: undo the resolve or dismiss that wrote `at`
 *
 * Every write is conditional on the state it expects (`src/lib/teacher/alert-actions.ts`), so an older Undo or a
 * stale queue cannot overwrite another instructor's newer decision. A mismatch answers 409 and changes nothing.
 */
export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!alertIdSchema.safeParse(id).success) throw badRequest("Invalid alert id");
  const input = await parseBody(req, alertActionSchema);

  const alert = await findAlertTarget(id);
  if (!alert) throw notFound("Alert not found");
  await assertStaffCanManageStudent(session, alert.studentId);

  const outcome = await applyAlertAction(alert, input, session.id, new Date());
  if (outcome.kind === "conflict") throw conflict(ALERT_CHANGED_MESSAGE);
  if (outcome.kind === "changed") {
    // After the write, so an action that failed is never recorded; a failed audit write is logged, not a 500.
    await tryLogAuditEvent(alertAuditEvent(alert.id, input, session));
  }
  return NextResponse.json(outcome.response);
});
