import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

const COUNTY_CATEGORY = "county";

function parseOptionalDate(value: unknown) {
  if (!value || typeof value !== "string") return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const GET = withTeacherAuth(async (_session, req: Request) => {
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
    prisma.spokesRecord.findMany({
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
    }),
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
  const body = await req.json();

  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

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
