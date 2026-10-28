import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { taskDetails } from "@/lib/dashboard/task-schemas";
import { createAssignedTask } from "@/lib/dashboard/tasks";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications";

const schema = taskDetails.extend({ appointmentId: z.union([z.string().cuid(), z.literal("")]).optional() }).strict();
export const POST = withTeacherAuth(async (session, req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id: identifier } = await params;
  const { appointmentId, ...details } = await parseBody(req, schema);
  // The route segment may be a login id, not the row id (#219): resolve it
  // first so the task and the notification both target the real student.
  const { id: studentId } = await assertStaffCanManageStudent(session, identifier);
  const result = await createAssignedTask(session, studentId, details, appointmentId);
  sendNotification(studentId, {
    type: "task", title: "New task assigned", body: `"${result.task.title}"${result.task.dueAt ? ` — due ${new Date(result.task.dueAt).toLocaleDateString()}` : ""}`,
  }).catch((err) => logger.error("Failed to send notification", { error: errorForLog(err) }));
  return NextResponse.json(result);
});
