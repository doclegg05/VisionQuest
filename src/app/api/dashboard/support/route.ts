import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { readSupport } from "@/lib/dashboard/support";
import { requireStudent } from "@/lib/dashboard/tasks";

export const GET = withAuth(async (session) => {
  requireStudent(session);
  return NextResponse.json(await readSupport(session.id), { headers: { "Cache-Control": "private, no-store" } });
});
