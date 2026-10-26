import { NextResponse } from "next/server";
import { badRequest, withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { deleteTaskSchema, taskId, updateTaskSchema } from "@/lib/dashboard/task-schemas";
import { deletePersonalTask, readTask, updateTasks } from "@/lib/dashboard/tasks";

type Context = { params: Promise<{ id: string }> };
async function readId(context: Context) {
  const result = taskId.safeParse((await context.params).id);
  if (!result.success) throw badRequest("Invalid task ID.");
  return result.data;
}
export const GET = withAuth(async (session, _req: Request, context: Context) => {
  const task = await readTask(session, await readId(context));
  return NextResponse.json({ task });
});
export const PATCH = withAuth(async (session, req: Request, context: Context) => {
  const id = await readId(context);
  const patch = await parseBody(req, updateTaskSchema);
  const { tasks, ...metadata } = await updateTasks(session, [{ id, patch }]);
  return NextResponse.json({ task: tasks[0], ...metadata });
});
export const DELETE = withAuth(async (session, req: Request, context: Context) => {
  const id = await readId(context);
  const { updatedAt } = await parseBody(req, deleteTaskSchema);
  return NextResponse.json(await deletePersonalTask(session, id, updatedAt));
});
