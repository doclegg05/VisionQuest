import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/schemas";

const COUNTY_CATEGORY = "county";

const deleteReferralSchema = z.object({
  id: z.string().min(1, "id is required."),
});

// Unlinked referrals (studentId: null) are applicants with no class yet. They
// belong to admins: withTeacherAuth admits only teachers and admins, and RLS
// gives unlinked rows to the admin role alone (migration
// 20261108100000_spokes_record_unlinked_admin_only). An instructor sees an
// empty list (SpokesManager loads this with its config, so a 403 would blank
// the whole panel) and cannot delete one.
async function listUnlinkedReferrals(county: string) {
  return prisma.spokesRecord.findMany({
    where: {
      studentId: null,
      ...(county ? { county } : {}),
    },
    orderBy: [{ referralDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      referralEmail: true,
      county: true,
      householdType: true,
      requiredParticipationHours: true,
      referralDate: true,
      status: true,
      notes: true,
      createdAt: true,
    },
  });
}

function parseOptionalDate(value: unknown) {
  if (!value || typeof value !== "string") return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const GET = withTeacherAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const county = searchParams.get("county")?.trim() || "";

  const [countyOptions, referrals] = await Promise.all([
    prisma.spokesChecklistTemplate.findMany({
      where: {
        category: COUNTY_CATEGORY,
        active: true,
      },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        description: true,
        sortOrder: true,
      },
    }),
    session.role === "admin" ? listUnlinkedReferrals(county) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    countyOptions,
    referrals,
    canCreateReferrals: session.role === "admin",
  });
});

const optionalText = z
  .string()
  .trim()
  .max(500, "That entry is too long.")
  .optional()
  .nullable()
  .transform((value) => value || null);

const createReferralSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100, "First name is too long."),
  lastName: z.string().trim().min(1, "Last name is required.").max(100, "Last name is too long."),
  referralEmail: optionalText,
  county: optionalText,
  householdType: optionalText,
  requiredParticipationHours: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  referralDate: z.string().optional().nullable(),
  notes: z.string().trim().max(5000, "Notes are too long.").optional().nullable(),
});

// A referral made here has no class: the record has no class field, only a
// link to a student. Under the organization tree an applicant with no class is
// visible to admins and program coordinators alone, so an instructor who made
// one could never see it again. Instructors place a student by adding them to
// one of their own classes instead.
export const POST = withTeacherAuth(async (session, req: Request) => {
  // Admin only: program coordinators read, they never create (Ruling R16).
  if (session.role !== "admin") {
    throw forbidden("Choose one of your classrooms.");
  }

  const body = await parseBody(req, createReferralSchema);

  const referral = await prisma.spokesRecord.create({
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      referralEmail: body.referralEmail,
      county: body.county,
      householdType: body.householdType,
      requiredParticipationHours: body.requiredParticipationHours ?? null,
      referralDate: parseOptionalDate(body.referralDate),
      status: "referred",
      notes: body.notes || null,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.referral.create",
    targetType: "spokes_record",
    targetId: referral.id,
    summary: "Created a standalone SPOKES referral.",
    metadata: {
      county: referral.county,
      standaloneReferral: true,
    },
  });

  return NextResponse.json({ referral }, { status: 201 });
});

export const DELETE = withTeacherAuth(async (session, req: Request) => {
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Only an admin manages unlinked referrals." }, { status: 403 });
  }

  const body = await parseBody(req, deleteReferralSchema);

  const referral = await prisma.spokesRecord.findUnique({
    where: { id: body.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      studentId: true,
    },
  });

  if (!referral) {
    return NextResponse.json({ error: "Referral not found." }, { status: 404 });
  }

  if (referral.studentId) {
    return NextResponse.json(
      { error: "Linked SPOKES records must be managed from the student workspace." },
      { status: 400 },
    );
  }

  await prisma.spokesRecord.delete({
    where: { id: body.id },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.referral.delete",
    targetType: "spokes_record",
    targetId: body.id,
    summary: `Deleted standalone SPOKES referral for ${referral.firstName} ${referral.lastName}.`,
    metadata: {
      standaloneReferral: true,
    },
  });

  return NextResponse.json({ ok: true });
});
