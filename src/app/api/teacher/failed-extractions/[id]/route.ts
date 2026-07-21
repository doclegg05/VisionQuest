import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth, badRequest, conflict, notFound, type Session } from "@/lib/api-error";
import { resolveAiProvider } from "@/lib/ai";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { GOAL_EXTRACTION_KEY, parseGoalExtractionPayload } from "@/lib/sage/failed-extraction";
import { extractGoals } from "@/lib/sage/goal-extractor";
import { proposeGoal } from "@/lib/sage/propose-goal";
import { parseBody } from "@/lib/schemas";

const actionSchema = z.object({
  action: z.enum(["replay", "dismiss"], {
    message: "Invalid action. Must be: replay or dismiss",
  }),
});

interface FailedExtractionRow {
  id: string;
  studentId: string;
  conversationId: string | null;
  sourceMessageId: string | null;
  extractorKey: string;
  payload: string;
}

async function resolveRow(id: string, status: string, resolvedBy: string) {
  await prisma.failedExtraction.update({
    where: { id },
    data: { status, resolvedBy, resolvedAt: new Date() },
  });
}

/**
 * Replay a dead-lettered goal extraction: re-run extractGoals on the stored
 * input snapshot and route any goals through the normal proposeGoal path
 * (idempotent on studentId + sourceMessageId + level, so re-replays cannot
 * double-propose).
 */
async function replayGoalExtraction(session: Session, row: FailedExtractionRow) {
  const snapshot = parseGoalExtractionPayload(row.payload);
  if (!snapshot) {
    throw badRequest("Stored payload is not replayable (malformed snapshot).");
  }
  if (!row.sourceMessageId) {
    throw badRequest("Original message reference is missing; cannot replay.");
  }

  // Same task/sensitivity as the original post-response extraction run.
  const provider = await resolveAiProvider({
    studentId: row.studentId,
    task: "sage_post_response",
    sensitivity: "student_record",
  });
  const extracted = await extractGoals(
    provider,
    snapshot.messages,
    snapshot.stage,
    snapshot.programType,
  );

  const outcomes = { created: 0, duplicate: 0, rejected: 0 };
  for (const goal of extracted.goals_found) {
    const result = await proposeGoal({
      studentId: row.studentId,
      level: goal.level,
      content: goal.content,
      sourceMessageId: row.sourceMessageId,
      conversationId: row.conversationId ?? undefined,
      invokedBy: session.id,
      confidence: goal.confidence,
    });
    outcomes[result.status] += 1;
  }

  await resolveRow(row.id, "replayed", session.id);
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.failed_extraction.replay",
    targetType: "failed_extraction",
    targetId: row.id,
    summary: `Replayed a failed goal extraction (${outcomes.created} proposed, ${outcomes.duplicate} duplicate, ${outcomes.rejected} rejected).`,
    metadata: { studentId: row.studentId, extractorKey: row.extractorKey, ...outcomes },
  });

  return NextResponse.json({ success: true, data: { status: "replayed", ...outcomes } });
}

/**
 * POST /api/teacher/failed-extractions/:id
 *
 * Manual staff actions on a dead-lettered extraction:
 * - action: "dismiss" — close the row without replaying.
 * - action: "replay"  — goal_extraction rows only; other extractors are
 *   manual-first and return 400 until they grow a replay path.
 */
export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!z.string().cuid().safeParse(id).success) {
    throw badRequest("Invalid failed-extraction id.");
  }
  const { action } = await parseBody(req, actionSchema);

  const row = await prisma.failedExtraction.findUnique({
    where: { id },
    select: {
      id: true,
      studentId: true,
      conversationId: true,
      sourceMessageId: true,
      extractorKey: true,
      payload: true,
      status: true,
    },
  });
  if (!row) throw notFound("Failed extraction not found");
  await assertStaffCanManageStudent(session, row.studentId);
  if (row.status !== "open") {
    throw conflict("This failed extraction has already been resolved.");
  }

  if (action === "dismiss") {
    await resolveRow(row.id, "dismissed", session.id);
    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "teacher.failed_extraction.dismiss",
      targetType: "failed_extraction",
      targetId: row.id,
      summary: "Dismissed a failed extraction without replaying it.",
      metadata: { studentId: row.studentId, extractorKey: row.extractorKey },
    });
    return NextResponse.json({ success: true, data: { status: "dismissed" } });
  }

  if (row.extractorKey !== GOAL_EXTRACTION_KEY) {
    throw badRequest("replay not supported for this extractor yet");
  }
  return replayGoalExtraction(session, row);
});
