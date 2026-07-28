import { NextResponse } from "next/server";
import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { recordMilestoneMemory } from "@/lib/sage/milestone-memory";

const CONFIRMABLE_FROM = new Set(["draft", "proposed"]);

/**
 * PATCH /api/teacher/students/[id]/career-plan
 * Confirm / edit a student's Career & Education Plan.
 */
export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: studentId } = await params;
  await assertStaffCanManageStudent(session, studentId);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Invalid JSON body.");
  }

  const plan = await prisma.careerEducationPlan.findUnique({
    where: { studentId },
  });
  if (!plan) throw notFound("Career & Education Plan not found for this student.");

  const updates: {
    terminalOutcome?: string;
    targetClusters?: string[];
    targetIndustries?: string[];
    onetCodes?: string[];
    summary?: string | null;
    ecpStatus?: string;
    status?: string;
    confirmedAt?: Date;
    confirmedBy?: string;
    lastReviewedAt?: Date;
    pathwayId?: string | null;
  } = {};

  if (typeof body.terminalOutcome === "string") {
    const outcome = body.terminalOutcome.trim();
    if (!["employment", "post_secondary", "both"].includes(outcome)) {
      throw badRequest("terminalOutcome must be employment, post_secondary, or both.");
    }
    updates.terminalOutcome = outcome;
  }
  if (Array.isArray(body.targetClusters)) {
    updates.targetClusters = body.targetClusters.filter((v: unknown) => typeof v === "string");
  }
  if (Array.isArray(body.targetIndustries)) {
    updates.targetIndustries = body.targetIndustries.filter((v: unknown) => typeof v === "string");
  }
  if (Array.isArray(body.onetCodes)) {
    updates.onetCodes = body.onetCodes.filter((v: unknown) => typeof v === "string");
  }
  if ("summary" in body) {
    updates.summary = typeof body.summary === "string" ? body.summary.trim() : null;
  }
  if (typeof body.ecpStatus === "string") {
    updates.ecpStatus = body.ecpStatus.trim();
  }
  if ("pathwayId" in body) {
    updates.pathwayId =
      body.pathwayId === null || body.pathwayId === ""
        ? null
        : String(body.pathwayId);
  }

  if (body.confirm === true || body.status === "confirmed") {
    if (!CONFIRMABLE_FROM.has(plan.status) && plan.status !== "confirmed") {
      throw badRequest(`Cannot confirm a plan with status '${plan.status}'.`);
    }
    updates.status = "confirmed";
    updates.confirmedAt = new Date();
    updates.confirmedBy = session.id;
  } else if (typeof body.status === "string") {
    const status = body.status.trim();
    if (!["draft", "proposed", "confirmed", "archived"].includes(status)) {
      throw badRequest("Invalid plan status.");
    }
    updates.status = status;
  }

  if (body.reviewed === true) {
    updates.lastReviewedAt = new Date();
  }

  if (Object.keys(updates).length === 0) {
    throw badRequest("No plan updates provided.");
  }

  const updated = await prisma.careerEducationPlan.update({
    where: { id: plan.id },
    data: updates,
  });

  if (updates.status === "confirmed") {
    await recordMilestoneMemory({
      studentId,
      kind: "career_plan_confirmed",
      title: "Career & Education Plan confirmed by instructor",
      detail: updated.summary ?? undefined,
      sourceId: updated.id,
    });
  }

  try {
    await invalidatePrefix(`student:${studentId}`);
  } catch {
    // Cache invalidation is best-effort.
  }

  return NextResponse.json({ plan: updated });
});
