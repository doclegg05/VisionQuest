/**
 * /api/sage/insights — list Sage's insights for a student, or write a new one.
 *
 * GET:  student sees their own insights; teacher/admin can pass
 *       ?studentId= to view a managed student's insights.
 * POST: only Sage tooling writes here (registry tool sage.record_insight).
 *       In Tier A this is invoked from the chat post-response loop
 *       (step 7 of the plan); in Tier B it becomes a Gemini tool-call.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, notFound, rateLimited } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { isStaffRole } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { recordInsight } from "@/lib/sage/record-insight";

const listQuerySchema = z.object({
  studentId: z.string().cuid().optional(),
  status: z
    .enum(["active", "dismissed", "edited", "all"])
    .default("active")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parse = listQuerySchema.safeParse({
    studentId: url.searchParams.get("studentId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parse.success) {
    throw badRequest("Invalid query parameters.");
  }
  const { studentId: requestedStudentId, status = "active", limit = 50 } = parse.data;

  // Resolve which student's insights we're listing.
  let targetStudentId: string;
  if (!requestedStudentId || requestedStudentId === session.id) {
    targetStudentId = session.id;
  } else {
    if (!isStaffRole(session.role)) {
      throw notFound("Insights not found.");
    }
    await assertStaffCanManageStudent(session, requestedStudentId);
    targetStudentId = requestedStudentId;
  }

  const insights = await prisma.sageInsight.findMany({
    where: {
      studentId: targetStudentId,
      ...(status === "all" ? {} : { status }),
    },
    select: {
      id: true,
      category: true,
      content: true,
      confidence: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      sourceConversationId: true,
      sourceMessageId: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ insights });
});

const recordInsightSchema = z.object({
  category: z.enum(["goal", "barrier", "strength", "context", "concern"]),
  content: z.string().min(1).max(2000),
  conversationId: z.string().cuid().optional(),
  sourceMessageId: z.string().cuid().optional(),
  confidence: z.number().min(0).max(1).optional(),
  /** Staff may record on behalf of a student — admin tooling only. */
  studentId: z.string().cuid().optional(),
});

export const POST = withRegistry("sage.record_insight", async (session, req: NextRequest) => {
  const rl = await rateLimit(`sage-insights:${session.id}`, 20, 60 * 60 * 1000);
  if (!rl.success) {
    throw rateLimited("Too many insights recorded this hour. Please wait before recording more.");
  }

  const body = await parseBody(req, recordInsightSchema);

  // Resolve which student the insight is for. Default to self.
  let targetStudentId: string;
  if (!body.studentId || body.studentId === session.id) {
    targetStudentId = session.id;
  } else {
    if (!isStaffRole(session.role)) {
      throw notFound("Insight target not found.");
    }
    await assertStaffCanManageStudent(session, body.studentId);
    targetStudentId = body.studentId;
  }

  const result = await recordInsight({
    studentId: targetStudentId,
    category: body.category,
    content: body.content,
    invokedBy: session.id,
    conversationId: body.conversationId,
    sourceMessageId: body.sourceMessageId,
    confidence: body.confidence,
  });

  if (result.status === "rejected") {
    return NextResponse.json(
      { error: result.reason, code: "INSIGHT_REJECTED" },
      { status: 400 },
    );
  }

  return NextResponse.json({ status: result.status, insightId: result.insightId });
});
