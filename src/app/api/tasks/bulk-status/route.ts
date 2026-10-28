import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { bulkTaskSchema } from "@/lib/dashboard/task-schemas";
import { updateTasks } from "@/lib/dashboard/tasks";

export const PATCH = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bulkTaskSchema);
  return NextResponse.json(await updateTasks(session, body.tasks.map(({ id, updatedAt }) => ({ id, patch: { status: body.status, updatedAt } }))));
});
