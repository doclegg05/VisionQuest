import { NextResponse } from "next/server";
import { z } from "zod";
import { syncStudentAlerts } from "@/lib/advising";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import {
  buildPlacementSuggestion,
  evaluatePlacementProvenance,
  getPlacementBridgeScope,
} from "@/lib/placement-bridge";
import { buildSpokesSummary, ensureSpokesRecordForStudent } from "@/lib/spokes";

// Phase 0A placement bridge: the only NEW input this route accepts. The rest
// of the PUT body keeps its legacy hand-rolled parsing deliberately — a
// wholesale Zod conversion of this staff surface is out of scope for the
// bridge slice (api-conventions.md's opportunistic-conversion rule noted).
const placementProvenanceSchema = z.object({
  // undefined → leave unchanged; null → clear the link; cuid → set it.
  placementApplicationId: z.string().cuid("Invalid application ID.").nullish(),
});

const placementApplicationSelect = {
  id: true,
  studentId: true,
  status: true,
  verificationStatus: true,
  verifiedAt: true,
  opportunity: { select: { title: true, company: true } },
} as const;

// CONTRACT: date fields do NOT carry forward — an absent/blank date in the
// body clears the stored value, so clients must submit the full form. (String
// fields differ: they carry forward when omitted.) Combined with the
// resulting-state check below, a partial PUT against a placement-linked
// record fails 400 rather than silently blanking the employment date.
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

export const GET = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  await assertStaffCanManageStudent(session, id);
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

  // Phase 0A placement bridge: prefill suggestion from the most recently
  // verified accepted application (flag-gated; null when off or recorded).
  const [placementScope, placementApplications, activeEnrollments] = await Promise.all([
    getPlacementBridgeScope(),
    prisma.application.findMany({
      where: { studentId: id },
      select: placementApplicationSelect,
    }),
    prisma.studentClassEnrollment.findMany({
      where: { studentId: id, status: "active" },
      select: { classId: true },
    }),
  ]);
  const placementSuggestion = buildPlacementSuggestion({
    scope: placementScope,
    activeClassIds: activeEnrollments.map((enrollment) => enrollment.classId),
    applications: placementApplications,
    spokesRecord: hydratedRecord,
  });

  return NextResponse.json({
    student,
    record: hydratedRecord,
    checklistTemplates,
    moduleTemplates,
    summary,
    placementSuggestion,
  });
});

export const PUT = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  await assertStaffCanManageStudent(session, id);
  const existingRecord = await ensureSpokesRecordForStudent(id);
  const body = await req.json();

  const provenanceParse = placementProvenanceSchema.safeParse(body);
  if (!provenanceParse.success) {
    return NextResponse.json(
      { error: provenanceParse.error.issues[0]?.message ?? "Invalid application ID." },
      { status: 400 }
    );
  }
  const requestedPlacementApplicationId = provenanceParse.data.placementApplicationId;

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

  // Phase 0A placement bridge: link the employment entry to the verified
  // accepted application that produced it. undefined → leave the existing
  // link unchanged; null → clear it; cuid → validate then set.
  let placementApplicationId = existingRecord.placementApplicationId;
  if (requestedPlacementApplicationId === null) {
    placementApplicationId = null;
  } else if (requestedPlacementApplicationId !== undefined) {
    // Scoped to the student on purpose: an application that exists but
    // belongs to someone else must be indistinguishable from one that does
    // not exist, so this route never acts as an existence oracle on global
    // Application ids.
    const application = await prisma.application.findFirst({
      where: { id: requestedPlacementApplicationId, studentId: id },
      select: placementApplicationSelect,
    });
    const check = evaluatePlacementProvenance({
      application,
      employmentDate: data.unsubsidizedEmploymentAt,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.message }, { status: check.status });
    }
    placementApplicationId = requestedPlacementApplicationId;
  }

  // The link/date invariant must hold on the RESULTING record, not only when
  // the link arrives in this request body: a later save that carries the
  // existing link forward while blanking unsubsidizedEmploymentAt would
  // otherwise strand a linked record with no start date.
  if (placementApplicationId && !data.unsubsidizedEmploymentAt) {
    return NextResponse.json(
      {
        error:
          "This record is linked to a placement application, so it needs an employment start date. Add the start date, or clear the application link first.",
      },
      { status: 400 }
    );
  }

  let record;
  try {
    record = await prisma.spokesRecord.update({
      where: { id: existingRecord.id },
      data: { ...data, placementApplicationId },
    });
  } catch (error: unknown) {
    // Unique constraint on placementApplicationId: another SPOKES record
    // already claims this application as its placement source. SpokesRecord
    // has other unique columns (studentId), so inspect meta.target and only
    // translate the placement collision — anything else is a real 500.
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const target = (error as { meta?: { target?: unknown } }).meta?.target;
      const targetFields = Array.isArray(target)
        ? target.map(String)
        : typeof target === "string"
          ? [target]
          : [];
      if (targetFields.some((field) => field.includes("placementApplicationId"))) {
        return NextResponse.json(
          { error: "That application is already linked to another placement record." },
          { status: 409 }
        );
      }
    }
    throw error;
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.record.update",
    targetType: "spokes_record",
    targetId: record.id,
    summary: `Updated SPOKES record for ${record.firstName} ${record.lastName}.`,
    metadata: {
      studentId: id,
      status: record.status,
      ...(record.placementApplicationId
        ? { placementApplicationId: record.placementApplicationId }
        : {}),
    },
  });

  // Recording employment (or clearing it) changes the desired state of the
  // "Record employment outcome" queue item — re-sync so it resolves/reopens
  // without waiting for the next background sweep.
  await syncStudentAlerts(id);

  return NextResponse.json({ record });
});
