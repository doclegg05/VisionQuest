import { prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId } from "@/lib/auth";
import { tryLogAuditEvent } from "@/lib/audit";
import type { IntakePayload } from "./schema";
import { saveStampedIntakePacket } from "./pdf-stamped-packet";

export interface ProvisionResult {
  studentDbId: string;
  studentId: string;
  displayName: string;
  isExisting: boolean;
  spokesRecordId: string;
  classId: string | null;
  className: string | null;
  orientationInitialized: boolean;
  pdfStorageKey?: string;
}

/**
 * Generate a unique, normalized student username based on first and last name.
 * e.g., "marcus.miller", "marcus.miller2", etc.
 */
async function generateUniqueStudentId(firstName: string, lastName: string): Promise<string> {
  const cleanFirst = firstName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = normalizeStudentId(`${cleanFirst}.${cleanLast}`) || "student";

  let candidate = base;
  let attempt = 1;

  while (attempt <= 50) {
    const existing = await prisma.student.findUnique({
      where: { studentId: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }

    attempt += 1;
    candidate = `${base}${attempt}`;
  }

  // Fallback to random hex suffix if 50 attempts collided
  return `${base}.${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Resolve an appropriate active SpokesClass for the student.
 * 1. Checks explicit `classId` if provided.
 * 2. Checks active class matching student's county.
 * 3. Falls back to any active class with programType 'spokes'.
 */
async function resolveActiveClass(
  county: string,
  explicitClassId?: string | null,
): Promise<{ id: string; name: string } | null> {
  if (explicitClassId) {
    const explicitClass = await prisma.spokesClass.findFirst({
      where: { id: explicitClassId, status: "active" },
      select: { id: true, name: true },
    });
    if (explicitClass) return explicitClass;
  }

  // Look for active class whose name or description mentions the county
  const countyMatch = await prisma.spokesClass.findFirst({
    where: {
      status: "active",
      OR: [
        { name: { contains: county, mode: "insensitive" } },
        { description: { contains: county, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  if (countyMatch) return countyMatch;

  // Fallback to the most recent active SPOKES class
  const fallback = await prisma.spokesClass.findFirst({
    where: { status: "active", programType: "spokes" },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  return fallback || null;
}

/**
 * Transactionally provisions an intake student, creates/updates their SpokesRecord,
 * enrolls them into an active class, initializes orientation checklist items,
 * and stamps the official state PDF packet with their electronic signature.
 */
export async function provisionIntakeStudent(payload: IntakePayload): Promise<ProvisionResult> {
  const normalizedEmail = payload.email ? normalizeEmail(payload.email) : null;
  const birthDateObj = new Date(payload.birthDate);

  // 1. Check for existing student by email
  let existingStudent = normalizedEmail
    ? await prisma.student.findFirst({
        where: { email: normalizedEmail },
        select: { id: true, studentId: true, displayName: true },
      })
    : null;

  // 2. Check for existing student via SpokesRecord (Name + Birth Date)
  if (!existingStudent) {
    const matchedRecord = await prisma.spokesRecord.findFirst({
      where: {
        firstName: { equals: payload.firstName, mode: "insensitive" },
        lastName: { equals: payload.lastName, mode: "insensitive" },
        birthDate: birthDateObj,
        studentId: { not: null },
      },
      select: { student: { select: { id: true, studentId: true, displayName: true } } },
    });

    if (matchedRecord?.student) {
      existingStudent = matchedRecord.student;
    }
  }

  const activeClass = await resolveActiveClass(payload.county, payload.classId);

  // --- Path A: Existing Student ---
  if (existingStudent) {
    const student = existingStudent;

    // Update SpokesRecord
    const spokesRecord = await prisma.spokesRecord.upsert({
      where: { studentId: student.id },
      create: {
        studentId: student.id,
        firstName: payload.firstName,
        lastName: payload.lastName,
        referralEmail: normalizedEmail,
        county: payload.county,
        householdType: payload.householdType,
        requiredParticipationHours: payload.requiredParticipationHours,
        referralDate: new Date(),
        status: "enrolled",
        enrolledAt: new Date(),
        gender: payload.gender,
        birthDate: birthDateObj,
        race: payload.race,
        ethnicity: payload.ethnicity,
        educationalLevel: payload.educationalLevel,
        notes: payload.notes,
      },
      update: {
        county: payload.county,
        householdType: payload.householdType ?? undefined,
        educationalLevel: payload.educationalLevel ?? undefined,
        notes: payload.notes ? payload.notes : undefined,
      },
    });

    // Ensure class enrollment
    if (activeClass) {
      const existingEnrollment = await prisma.studentClassEnrollment.findUnique({
        where: {
          classId_studentId: {
            classId: activeClass.id,
            studentId: student.id,
          },
        },
      });

      if (!existingEnrollment) {
        await prisma.studentClassEnrollment.create({
          data: {
            classId: activeClass.id,
            studentId: student.id,
            status: "active",
          },
        });
      }
    }

    // Generate & stamp updated PDF packet
    let pdfStorageKey: string | undefined;
    try {
      const packet = await saveStampedIntakePacket(student.id, student.studentId, payload);
      pdfStorageKey = packet.storageKey;
    } catch {
      // PDF stamping failure should not abort the successful provisioning
    }

    await tryLogAuditEvent({
      actorId: null,
      actorRole: "system",
      action: "student.intake.updated",
      targetType: "student",
      targetId: student.id,
      summary: `Automated intake updated records for existing student ${student.studentId}.`,
      metadata: { county: payload.county, isExisting: true },
    });

    return {
      studentDbId: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      isExisting: true,
      spokesRecordId: spokesRecord.id,
      classId: activeClass?.id ?? null,
      className: activeClass?.name ?? null,
      orientationInitialized: true,
      pdfStorageKey,
    };
  }

  // --- Path B: Brand New Student ---
  const newStudentId = await generateUniqueStudentId(payload.firstName, payload.lastName);
  const displayName = `${payload.firstName} ${payload.lastName}`;

  // Default temporary password: Spokes[CurrentYear]!
  const defaultTempPassword = `Spokes${new Date().getFullYear()}!`;
  const { hash } = hashPassword(defaultTempPassword);

  const { student, spokesRecord } = await prisma.$transaction(async (tx) => {
    // 1. Create Student
    const createdStudent = await tx.student.create({
      data: {
        studentId: newStudentId,
        displayName,
        email: normalizedEmail,
        passwordHash: hash,
        role: "student",
        isActive: true,
      },
    });

    // 2. Create SpokesRecord
    const createdSpokes = await tx.spokesRecord.create({
      data: {
        studentId: createdStudent.id,
        firstName: payload.firstName,
        lastName: payload.lastName,
        referralEmail: normalizedEmail,
        county: payload.county,
        householdType: payload.householdType,
        requiredParticipationHours: payload.requiredParticipationHours,
        referralDate: new Date(),
        status: "enrolled",
        enrolledAt: new Date(),
        gender: payload.gender,
        birthDate: birthDateObj,
        race: payload.race,
        ethnicity: payload.ethnicity,
        educationalLevel: payload.educationalLevel,
        notes: payload.notes,
      },
    });

    // 3. Enroll into Class if resolved
    if (activeClass) {
      await tx.studentClassEnrollment.create({
        data: {
          classId: activeClass.id,
          studentId: createdStudent.id,
          status: "active",
        },
      });
    }

    // 4. Initialize Orientation Items
    const orientationItems = await tx.orientationItem.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, label: true, description: true },
    });

    if (orientationItems.length > 0) {
      const progressEntries = orientationItems.map((item) => {
        const lower = `${item.label} ${item.description || ""}`.toLowerCase();
        const isConsentOrPolicy =
          lower.includes("ferpa") ||
          lower.includes("policy") ||
          lower.includes("agreement") ||
          lower.includes("handbook") ||
          lower.includes("profile");

        const completed = isConsentOrPolicy && (payload.ferpaConsentSigned || payload.policyAcknowledgmentSigned);

        return {
          studentId: createdStudent.id,
          itemId: item.id,
          completed,
          completedAt: completed ? new Date() : null,
          verificationStatus: completed ? ("verified" as const) : null,
          verifiedAt: completed ? new Date() : null,
          verifiedBy: completed ? "system:intake_webhook" : null,
        };
      });

      await tx.orientationProgress.createMany({
        data: progressEntries,
      });
    }

    return { student: createdStudent, spokesRecord: createdSpokes };
  }, { maxWait: 10000, timeout: 25000 });

  // 5. Generate & stamp official PDF packet
  let pdfStorageKey: string | undefined;
  try {
    const packet = await saveStampedIntakePacket(student.id, student.studentId, payload);
    pdfStorageKey = packet.storageKey;
  } catch {
    // Non-fatal: logged below
  }

  await tryLogAuditEvent({
    actorId: null,
    actorRole: "system",
    action: "student.intake.provisioned",
    targetType: "student",
    targetId: student.id,
    summary: `Automated intake provisioned new student ${student.studentId} in ${activeClass?.name || payload.county}.`,
    metadata: {
      county: payload.county,
      classId: activeClass?.id,
      pdfGenerated: Boolean(pdfStorageKey),
    },
  });

  return {
    studentDbId: student.id,
    studentId: student.studentId,
    displayName: student.displayName,
    isExisting: false,
    spokesRecordId: spokesRecord.id,
    classId: activeClass?.id ?? null,
    className: activeClass?.name ?? null,
    orientationInitialized: true,
    pdfStorageKey,
  };
}
