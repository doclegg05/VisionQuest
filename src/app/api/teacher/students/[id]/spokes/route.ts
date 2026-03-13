import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { buildSpokesSummary, ensureSpokesRecordForStudent } from "@/lib/spokes";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

function parseOptionalDate(value: unknown) {
  if (!value || typeof value !== "string") return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseOptionalFloat(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      id: true,
      studentId: true,
      displayName: true,
      email: true,
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const record = await ensureSpokesRecordForStudent(id);
  const [checklistTemplates, moduleTemplates, hydratedRecord] = await Promise.all([
    prisma.spokesChecklistTemplate.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.spokesModuleTemplate.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.spokesRecord.findUnique({
      where: { id: record.id },
      include: {
        checklistProgress: true,
        moduleProgress: {
          orderBy: { completedAt: "asc" },
        },
        employmentFollowUps: {
          orderBy: { checkpointMonths: "asc" },
        },
      },
    }),
  ]);

  if (!hydratedRecord) {
    return NextResponse.json({ error: "SPOKES record not found." }, { status: 404 });
  }

  const summary = buildSpokesSummary({
    record: hydratedRecord,
    checklistTemplates,
    checklistProgress: hydratedRecord.checklistProgress,
    moduleTemplates,
    moduleProgress: hydratedRecord.moduleProgress,
    employmentFollowUps: hydratedRecord.employmentFollowUps,
  });

  return NextResponse.json({
    student,
    record: hydratedRecord,
    checklistTemplates,
    moduleTemplates,
    summary,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existingRecord = await ensureSpokesRecordForStudent(id);
  const body = await req.json();
  const data = {
    firstName: typeof body.firstName === "string" && body.firstName.trim() ? body.firstName.trim() : existingRecord.firstName,
    lastName: typeof body.lastName === "string" && body.lastName.trim() ? body.lastName.trim() : existingRecord.lastName,
    referralEmail:
      body.referralEmail === ""
        ? null
        : typeof body.referralEmail === "string"
          ? body.referralEmail.trim()
          : existingRecord.referralEmail,
    county:
      body.county === ""
        ? null
        : typeof body.county === "string"
          ? body.county.trim()
          : existingRecord.county,
    householdType:
      body.householdType === ""
        ? null
        : typeof body.householdType === "string"
          ? body.householdType.trim()
          : existingRecord.householdType,
    requiredParticipationHours:
      body.requiredParticipationHours === ""
        ? null
        : Number.isFinite(Number(body.requiredParticipationHours))
          ? Number(body.requiredParticipationHours)
          : existingRecord.requiredParticipationHours,
    referralDate: parseOptionalDate(body.referralDate),
    status:
      typeof body.status === "string" && body.status.trim()
        ? body.status.trim()
        : existingRecord.status,
    enrolledAt: parseOptionalDate(body.enrolledAt),
    exitDate: parseOptionalDate(body.exitDate),
    gender:
      body.gender === ""
        ? null
        : typeof body.gender === "string"
          ? body.gender.trim()
          : existingRecord.gender,
    birthDate: parseOptionalDate(body.birthDate),
    race:
      body.race === ""
        ? null
        : typeof body.race === "string"
          ? body.race.trim()
          : existingRecord.race,
    ethnicity:
      body.ethnicity === ""
        ? null
        : typeof body.ethnicity === "string"
          ? body.ethnicity.trim()
          : existingRecord.ethnicity,
    barriersOnEntry: coerceStringArray(body.barriersOnEntry),
    barriersRemaining: coerceStringArray(body.barriersRemaining),
    jobRetentionStudent: Boolean(body.jobRetentionStudent),
    tabeDate: parseOptionalDate(body.tabeDate),
    educationalLevel:
      body.educationalLevel === ""
        ? null
        : typeof body.educationalLevel === "string"
          ? body.educationalLevel.trim()
          : existingRecord.educationalLevel,
    documentedAcademicAchievementAt: parseOptionalDate(body.documentedAcademicAchievementAt),
    highSchoolEquivalencyAt: parseOptionalDate(body.highSchoolEquivalencyAt),
    familySurveyOfferedAt: parseOptionalDate(body.familySurveyOfferedAt),
    postSecondaryEnteredAt: parseOptionalDate(body.postSecondaryEnteredAt),
    postSecondaryProgram:
      body.postSecondaryProgram === ""
        ? null
        : typeof body.postSecondaryProgram === "string"
          ? body.postSecondaryProgram.trim()
          : existingRecord.postSecondaryProgram,
    unsubsidizedEmploymentAt: parseOptionalDate(body.unsubsidizedEmploymentAt),
    employerName:
      body.employerName === ""
        ? null
        : typeof body.employerName === "string"
          ? body.employerName.trim()
          : existingRecord.employerName,
    hourlyWage: parseOptionalFloat(body.hourlyWage),
    nonCompleterAt: parseOptionalDate(body.nonCompleterAt),
    nonCompleterReason:
      body.nonCompleterReason === ""
        ? null
        : typeof body.nonCompleterReason === "string"
          ? body.nonCompleterReason.trim()
          : existingRecord.nonCompleterReason,
    notes:
      body.notes === ""
        ? null
        : typeof body.notes === "string"
          ? body.notes
          : existingRecord.notes,
  };

  const record = await prisma.spokesRecord.update({
    where: { id: existingRecord.id },
    data,
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.spokes.record.update",
    targetType: "spokes_record",
    targetId: record.id,
    summary: `Updated SPOKES record for ${record.firstName} ${record.lastName}.`,
    metadata: {
      studentId: id,
      status: record.status,
    },
  });

  return NextResponse.json({ record });
}
