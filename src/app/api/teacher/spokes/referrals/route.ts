import { NextResponse } from "next/server";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { seesWholeState } from "@/lib/org-roles";
import { parseBody } from "@/lib/schemas";

const COUNTY_CATEGORY = "county";

const deleteReferralSchema = z.object({
  id: z.string().min(1, "id is required."),
});

// Unlinked referrals (studentId: null) are applicants with no class yet. Under
// the organization tree they belong to admins and program coordinators only;
// an instructor sees an empty list (SpokesManager loads this with its config,
// so a 403 would blank the whole panel) and cannot delete one.
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
    seesWholeState(session.role) ? listUnlinkedReferrals(county) : Promise.resolve([]),
  ]);

  return NextResponse.json({ countyOptions, referrals });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();

  if (typeof body.firstName !== "string" || !body.firstName.trim()) {
    return NextResponse.json({ error: "First name is required." }, { status: 400 });
  }

  if (typeof body.lastName !== "string" || !body.lastName.trim()) {
    return NextResponse.json({ error: "Last name is required." }, { status: 400 });
  }

  const referral = await prisma.spokesRecord.create({
    data: {
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      referralEmail:
        typeof body.referralEmail === "string" && body.referralEmail.trim()
          ? body.referralEmail.trim()
          : null,
      county: typeof body.county === "string" && body.county.trim() ? body.county.trim() : null,
      householdType:
        typeof body.householdType === "string" && body.householdType.trim()
          ? body.householdType.trim()
          : null,
      requiredParticipationHours: Number.isFinite(Number(body.requiredParticipationHours))
        ? Number(body.requiredParticipationHours)
        : null,
      referralDate: parseOptionalDate(body.referralDate),
      status: "referred",
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.referral.create",
    targetType: "spokes_record",
    targetId: referral.id,
    summary: `Created SPOKES referral for ${referral.firstName} ${referral.lastName}.`,
    metadata: {
      county: referral.county,
      standaloneReferral: true,
    },
  });

  return NextResponse.json({ referral }, { status: 201 });
});

export const DELETE = withTeacherAuth(async (session, req: Request) => {
  if (!seesWholeState(session.role)) {
    return NextResponse.json(
      { error: "Only admins and program coordinators manage unlinked referrals." },
      { status: 403 },
    );
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
