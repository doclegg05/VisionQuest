import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, withTeacherAuth } from "@/lib/api-error";
import { fetchConnectFunnel } from "@/lib/connect/funnel";

/**
 * GET /api/teacher/reports/connect — the Connect funnel (Match & Connect
 * Task 6.1). Where connections stall, per class and per employer, plus the
 * self-directed comparison line.
 *
 * `classId` is validated against `assertStaffCanManageClass` inside
 * `fetchConnectFunnel`, the same way `intervention-queue`'s route does —
 * a class the caller does not manage 403s rather than silently returning an
 * empty report.
 *
 * No `recordStudentView`: the response is aggregate counts only, no
 * per-student list leaves this route.
 */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional();

const querySchema = z.object({
  classId: z.string().cuid("Invalid classId.").optional(),
  employerId: z.string().cuid("Invalid employerId.").optional(),
  from: dateOnly,
  to: dateOnly,
});

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    classId: url.searchParams.get("classId") ?? undefined,
    employerId: url.searchParams.get("employerId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid filter.");
  }
  const query = parsed.data;

  const funnel = await fetchConnectFunnel(session, {
    classId: query.classId,
    employerId: query.employerId,
    from: query.from,
    to: query.to,
  });

  return NextResponse.json({ success: true, data: funnel });
});
