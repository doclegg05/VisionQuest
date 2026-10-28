import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { readActivity } from "@/lib/dashboard/readers";
import { requireStudent } from "@/lib/dashboard/tasks";

export const GET = withAuth(async (session) => {
  requireStudent(session);
  return NextResponse.json(await readActivity(session.id), { headers: { "Cache-Control": "private, no-store" } });
});
