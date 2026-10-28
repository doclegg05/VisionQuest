import { NextResponse } from "next/server";
import { badRequest, withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { createTaskSchema, taskQuerySchema } from "@/lib/dashboard/task-schemas";
import { createPersonalTask, readTasks, requireStudent } from "@/lib/dashboard/tasks";

export const GET = withAuth(async (session, req: Request) => {
  requireStudent(session);
  const params = new URL(req.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length) throw badRequest("Duplicate query parameters.");
  const query = taskQuerySchema.safeParse(Object.fromEntries(params));
  if (!query.success) throw badRequest(query.error.issues[0].message);
  return NextResponse.json(await readTasks(session.id, query.data), { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = withAuth(async (session, req: Request) => {
  requireStudent(session);
  return NextResponse.json(await createPersonalTask(session, await parseBody(req, createTaskSchema)), { status: 201 });
});
