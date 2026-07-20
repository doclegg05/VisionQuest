import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { withAuth, badRequest, forbidden, isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { getSignatureRequiredForms } from "@/lib/orientation-step-resources";
import { parseBody } from "@/lib/schemas";

const orientationToggleSchema = z.object({
  // Not .cuid(): the canonical seed (scripts/seed-data.mjs) creates items
  // with deterministic ids like "seed-orient-70", which a cuid check
  // rejects — breaking completion on any freshly-seeded database. The id
  // only ever reaches parameterized Prisma lookups, so a length-capped
  // slug shape is sufficient.
  itemId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, "Invalid orientation item ID."),
  completed: z.boolean(),
  studentId: z.string().cuid("Invalid student ID.").optional(),
});

async function resolveTargetStudentId(session: Session, requestedStudentId?: string | null) {
  const targetStudentId = requestedStudentId?.trim() || session.id;

  if (targetStudentId !== session.id) {
    if (!isStaffRole(session.role)) {
      throw forbidden();
    }

    await assertStaffCanManageStudent(session, targetStudentId);
  }

  return targetStudentId;
}

// GET — list orientation items with student's progress
export const GET = withAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const targetStudentId = await resolveTargetStudentId(session, searchParams.get("studentId"));

  const items = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      progress: {
        where: { studentId: targetStudentId },
        select: { completed: true, completedAt: true },
      },
    },
  });

  const formatted = items.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    section: item.section ?? null,
    required: item.required,
    completed: item.progress[0]?.completed ?? false,
    completedAt: item.progress[0]?.completedAt ?? null,
  }));

  const total = formatted.length;
  const done = formatted.filter((i) => i.completed).length;

  return NextResponse.json({ items: formatted, total, done });
});

/**
 * Guard (P0-1): a student may not mark an item complete when its orientation
 * step requires a signature that is not yet on file. The wizard signs first
 * (POST /api/forms/sign) and then marks the item complete, so completions with
 * every required signature recorded pass through. A submission counts as
 * signed when it carries a SignaturePad image (`signatureFileId`) or staff
 * approved an uploaded signed copy. Staff completions skip this guard — the
 * `assertStaffCanManageStudent` path in `resolveTargetStudentId` already
 * vetted them, and staff override stays allowed.
 */
async function assertRequiredSignaturesOnFile(studentId: string, itemId: string) {
  const item = await prisma.orientationItem.findUnique({
    where: { id: itemId },
    select: { label: true },
  });
  // Unknown item: fall through — the upsert's FK constraint rejects it as before.
  if (!item) return;

  const signForms = getSignatureRequiredForms(item.label);
  if (signForms.length === 0) return;

  const signedSubmissions = await prisma.formSubmission.findMany({
    where: {
      studentId,
      formId: { in: signForms.map((form) => form.id) },
      OR: [{ signatureFileId: { not: null } }, { status: "approved" }],
    },
    select: { formId: true },
  });
  const signedFormIds = new Set(signedSubmissions.map((submission) => submission.formId));

  if (signForms.some((form) => !signedFormIds.has(form.id))) {
    throw badRequest("This one needs your signature — you'll sign it in Orientation.");
  }
}

// POST — toggle an orientation item's completion
export const POST = withAuth(async (session, req: Request) => {
  const { itemId, completed, studentId } = await parseBody(req, orientationToggleSchema);

  const targetStudentId = await resolveTargetStudentId(session, studentId);

  if (completed && !isStaffRole(session.role)) {
    await assertRequiredSignaturesOnFile(targetStudentId, itemId);
  }

  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId: targetStudentId, itemId } },
    update: { completed, completedAt: completed ? new Date() : null },
    create: { studentId: targetStudentId, itemId, completed, completedAt: completed ? new Date() : null },
  });

  await syncStudentAlerts(targetStudentId);

  return NextResponse.json({ ok: true });
});
