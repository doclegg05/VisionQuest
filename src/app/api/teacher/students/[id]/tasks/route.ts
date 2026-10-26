import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { taskDetails } from "@/lib/dashboard/task-schemas";
import { createAssignedTask } from "@/lib/dashboard/tasks";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications";

const schema = taskDetails.extend({ appointmentId: z.union([z.string().cuid(), z.literal("")]).optional() }).strict();
export const POST = withTeacherAuth(async (session, req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id: studentId } = await params;
  const { appointmentId, ...details } = await parseBody(req, schema);
  const result = await createAssignedTask(session, studentId, details, appointmentId);
  sendNotification(studentId, {
    type: "task", title: "New task assigned", body: `"${result.task.title}"${result.task.dueAt ? ` — due ${new Date(result.task.dueAt).toLocaleDateString()}` : ""}`,
  }).catch((err) => logger.error("Failed to send notification", { error: String(err) }));
  return NextResponse.json(result);
});
