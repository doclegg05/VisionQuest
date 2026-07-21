import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { withAuth, badRequest, forbidden, isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { applyStudentOrientationCompletion } from "@/lib/orientation-completion";
import { isVerificationRequiredItem } from "@/lib/orientation-step-resources";
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
  // Staff-only (P1-1): resolve a pending verification claim on an
  // honor-system item. "confirm" completes + verifies; "decline" sends the
  // step back to the student.
  verify: z.enum(["confirm", "decline"]).optional(),
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
        select: { completed: true, completedAt: true, verificationStatus: true, verifiedAt: true },
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
    verificationStatus: item.progress[0]?.verificationStatus ?? null,
    verifiedAt: item.progress[0]?.verifiedAt ?? null,
  }));

  const total = formatted.length;
  const done = formatted.filter((i) => i.completed).length;
  const pendingVerification = formatted.filter(
    (i) => !i.completed && i.verificationStatus === "pending",
  ).length;

  return NextResponse.json({ items: formatted, total, done, pendingVerification });
});

/**
 * Student "un-mark" (completed: false): clears completion AND withdraws any
 * outstanding verification claim so the item reads as plain incomplete.
 */
async function resetProgress(studentId: string, itemId: string) {
  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId, itemId } },
    update: {
      completed: false,
      completedAt: null,
      verificationStatus: null,
      verifiedBy: null,
      verifiedAt: null,
    },
    create: { studentId, itemId, completed: false },
  });
}

/**
 * Staff decline (P1-1): the student's honor-system claim is rejected — the
 * step goes back to incomplete with `verificationStatus: "declined"` so the
 * student sees it needs redoing.
 */
async function declineVerification(session: Session, studentId: string, itemId: string) {
  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId, itemId } },
    update: {
      completed: false,
      completedAt: null,
      verificationStatus: "declined",
      verifiedBy: session.id,
      verifiedAt: new Date(),
    },
    create: {
      studentId,
      itemId,
      completed: false,
      verificationStatus: "declined",
      verifiedBy: session.id,
      verifiedAt: new Date(),
    },
  });
}

/**
 * Staff completion. The `assertStaffCanManageStudent` path in
 * `resolveTargetStudentId` already vetted the actor, so no signature guard
 * runs (staff override stays allowed). Honor-system items — or an explicit
 * `verify: "confirm"` — additionally record who verified and when.
 */
async function completeAsStaff(session: Session, studentId: string, itemId: string, verify?: string) {
  const item = await prisma.orientationItem.findUnique({
    where: { id: itemId },
    select: { label: true },
  });
  const verifies = verify === "confirm" || (item ? isVerificationRequiredItem(item.label) : false);
  const now = new Date();
  const verificationFields = verifies
    ? { verificationStatus: "verified", verifiedBy: session.id, verifiedAt: now }
    : { verificationStatus: null, verifiedBy: null, verifiedAt: null };

  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId, itemId } },
    update: { completed: true, completedAt: now, ...verificationFields },
    create: { studentId, itemId, completed: true, completedAt: now, ...verificationFields },
  });
  return verifies;
}

// POST — toggle an orientation item's completion
export const POST = withAuth(async (session, req: Request) => {
  const { itemId, completed, studentId, verify } = await parseBody(req, orientationToggleSchema);

  const targetStudentId = await resolveTargetStudentId(session, studentId);
  const staff = isStaffRole(session.role);

  if (verify && !staff) {
    throw forbidden("Only instructors can verify orientation steps.");
  }

  if (!staff && completed) {
    // Student path — shared rules (signature guard P0-1 + verification P1-1).
    const result = await applyStudentOrientationCompletion(targetStudentId, itemId);
    if (result.outcome === "signature_required") {
      throw badRequest(result.message);
    }
    await syncStudentAlerts(targetStudentId);
    if (result.outcome === "pending_verification") {
      return NextResponse.json({ success: true, data: { pendingVerification: true } });
    }
    return NextResponse.json({ ok: true });
  }

  if (staff && verify === "decline") {
    await declineVerification(session, targetStudentId, itemId);
    await syncStudentAlerts(targetStudentId);
    return NextResponse.json({ success: true, data: { verificationStatus: "declined" } });
  }

  if (staff && (completed || verify === "confirm")) {
    const verified = await completeAsStaff(session, targetStudentId, itemId, verify);
    await syncStudentAlerts(targetStudentId);
    if (verified) {
      return NextResponse.json({ success: true, data: { verificationStatus: "verified" } });
    }
    return NextResponse.json({ ok: true });
  }

  await resetProgress(targetStudentId, itemId);
  await syncStudentAlerts(targetStudentId);
  return NextResponse.json({ ok: true });
});
