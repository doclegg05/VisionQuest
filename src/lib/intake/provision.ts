import { randomInt, randomUUID } from "node:crypto";
import { prismaAdmin as prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId } from "@/lib/auth";
import { tryLogAuditEvent } from "@/lib/audit";
import { invalidateChatContext } from "@/lib/cache";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import type { IntakePayload } from "./schema";
import { saveStampedIntakePacket } from "./pdf-stamped-packet";

/**
 * SPOKES intake provisioning.
 *
 * Two doors reach this module and they are not equally trusted:
 *
 *   "staff"  — POST /api/intake/webhook, behind a bearer secret or a staff
 *              session. May name a class, may refresh an existing student's
 *              record, and receives the new account's one-time password.
 *   "public" — POST /api/intake/submit, which anyone on the internet can
 *              call. May create a brand-new account and nothing else: it
 *              never learns whether the person it described already has one,
 *              never writes to an account it did not create, never chooses a
 *              cohort, and is never handed a credential.
 *
 * `source` is required rather than defaulted, so a future caller has to state
 * which door it is; a default would silently hand the public trust level to
 * staff, or the staff trust level to the public.
 *
 * Every query here runs through `prismaAdmin`. These calls have no request
 * session, so the app client would run under `vq_app` with empty RLS GUCs and
 * fail closed (src/lib/db.ts). That accident is what held the takeover shut
 * before the auth design was fixed — it is not a control, and it must not be
 * relied on as one. Nothing written here is a model the chat-context
 * write-through extension watches for an EXISTING student: OrientationProgress
 * rows are created only for an account created microseconds earlier, which has
 * no cached chat context to invalidate.
 */

/** Which door the payload came through. */
export type IntakeSource = "public" | "staff";

export interface ProvisionOptions {
  source: IntakeSource;
}

interface AccountSummary {
  studentDbId: string;
  studentId: string;
  displayName: string;
  spokesRecordId: string;
  classId: string | null;
  className: string | null;
  orientationInitialized: boolean;
  pdfStorageKey?: string;
}

export interface ProvisionedResult extends AccountSummary {
  outcome: "provisioned";
  /**
   * The one-time password, present exactly when `source` was "staff". On the
   * public path this is `null` and no password is minted at all: the account
   * is created with no `passwordHash`, so there is no secret in scope for an
   * anonymous response to print, and login fails closed until staff issues one
   * through /api/teacher/students/[id]/reset-password.
   */
  temporaryPassword: string | null;
}

export interface UpdatedResult extends AccountSummary {
  outcome: "updated";
}

/**
 * The public form matched an account that already exists. Deliberately carries
 * nothing that identifies it — not the id, not the username, not the display
 * name. The route returns the same body it returns for a new enrollment, so
 * the endpoint is not an oracle for "is this person enrolled here".
 */
export interface DuplicatePendingReviewResult {
  outcome: "duplicate_pending_review";
}

export type ProvisionResult =
  | ProvisionedResult
  | UpdatedResult
  | DuplicatePendingReviewResult;

/**
 * Alphabet for staff-issued passwords: upper case and digits with I, O, 0 and
 * 1 removed, because a human reads this aloud or copies it off a printout.
 */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_GROUPS = 4;
const PASSWORD_GROUP_SIZE = 4;

/**
 * A per-account temporary password from the CSPRNG. Sixteen characters over a
 * 32-symbol alphabet is 80 bits, grouped for transcription. `randomInt` is
 * rejection-sampled by Node, so the draw is unbiased; `Math.random` would be
 * neither unbiased nor unpredictable.
 */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < PASSWORD_GROUPS; g += 1) {
    let group = "";
    for (let c = 0; c < PASSWORD_GROUP_SIZE; c += 1) {
      group += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
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

  // Fifty collisions on one name means the suffix is no longer distinguishing
  // anything, so fall back to an unguessable one. Sourced from the CSPRNG:
  // a username is public-ish, but a predictable one lets an attacker know
  // which account the next intake will create.
  return `${base}.${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * Resolve the SPOKES class this student belongs in.
 *
 * County match only. The old "most recent active SPOKES class" fallback put an
 * unmatched student into an arbitrary cohort, and because `managed_student_ids()`
 * is enrollment-based, that handed the student's record to whichever
 * instructors happened to teach it (review finding M7). No match now means no
 * enrollment: staff places them, which is the outcome that was going to be
 * needed anyway.
 *
 * A caller-supplied `classId` is honored only for `source: "staff"`. On the
 * public path it is the same disclosure by another route — an anonymous caller
 * naming a class grants that class's instructors read access to whoever the
 * form described (M16).
 */
async function resolveActiveClass(
  county: string,
  explicitClassId: string | null | undefined,
  source: IntakeSource,
): Promise<{ id: string; name: string } | null> {
  if (source === "staff" && explicitClassId) {
    const explicitClass = await prisma.spokesClass.findFirst({
      where: { id: explicitClassId, status: "active" },
      select: { id: true, name: true },
    });
    if (explicitClass) return explicitClass;
  }

  return prisma.spokesClass.findFirst({
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
}

/**
 * Consent items a signed intake form speaks to. Kept as a named list so the
 * substring rule is readable rather than a chain of `||`.
 */
const CONSENT_ITEM_KEYWORDS = ["ferpa", "policy", "agreement", "handbook", "profile"] as const;

function isConsentItem(label: string, description: string | null | undefined): boolean {
  const haystack = `${label} ${description ?? ""}`.toLowerCase();
  return CONSENT_ITEM_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Record a duplicate public submission where staff will see it, without
 * telling the submitter anything.
 *
 * `alertKey` is one row per matched student, so a repeat submitter updates the
 * same row instead of filling the queue. The type is absent from
 * STUDENT_VISIBLE_ALERT_TYPES (src/lib/student-alerts.ts), so the student
 * whose name was submitted never sees this text — which matters, because the
 * submitter may not be them.
 *
 * Never throws: a real returning student's submission has already been refused
 * a session, and failing the request on top of that helps nobody.
 */
async function recordDuplicateIntakeAlert(matchedStudentId: string): Promise<void> {
  const now = new Date();
  const summary =
    "A public SPOKES intake form was submitted matching this student's name and date of birth. " +
    "No account was changed and no sign-in was issued. Confirm whether this is the same person " +
    "re-enrolling, and if so complete their intake from the staff tools.";

  try {
    await prisma.studentAlert.upsert({
      where: { alertKey: `intake-duplicate:${matchedStudentId}` },
      create: {
        studentId: matchedStudentId,
        alertKey: `intake-duplicate:${matchedStudentId}`,
        type: "duplicate_intake_submission",
        severity: "medium",
        status: "open",
        title: "Duplicate intake submission needs review",
        summary,
        sourceType: "intake_public_form",
        detectedAt: now,
      },
      update: { status: "open", detectedAt: now, summary },
    });
  } catch (error: unknown) {
    logger.error("Could not record a duplicate intake submission for staff review", {
      alert: "intake_duplicate_alert_failed",
      student: studentLogKey(matchedStudentId),
      error: errorForLog(error),
    });
  }
}

async function stampPacket(
  studentDbId: string,
  studentId: string,
  payload: IntakePayload,
): Promise<string | undefined> {
  try {
    const packet = await saveStampedIntakePacket(studentDbId, studentId, payload);
    return packet.storageKey;
  } catch (error: unknown) {
    // Non-fatal: the enrollment stands, the packet can be regenerated.
    logger.warn("Intake packet stamping failed", {
      alert: "intake_packet_stamp_failed",
      student: studentLogKey(studentDbId),
      error: errorForLog(error),
    });
    return undefined;
  }
}

/**
 * Transactionally provisions an intake student, creates/updates their SpokesRecord,
 * enrolls them into an active class, initializes orientation checklist items,
 * and stamps the official state PDF packet with their electronic signature.
 */
export async function provisionIntakeStudent(
  payload: IntakePayload,
  options: ProvisionOptions,
): Promise<ProvisionResult> {
  const { source } = options;
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

  // --- Path A: the submitted details match an account that already exists ---
  if (existingStudent) {
    // On the public path a match ENDS the request. A name and a date of birth
    // are not authentication, so treating a match as "this is that person" is
    // how an anonymous POST used to come back holding their session cookie
    // (review finding B1). Nothing is read out, nothing is written to their
    // record (M17), and the caller is told the same thing a new applicant is
    // told.
    if (source === "public") {
      await recordDuplicateIntakeAlert(existingStudent.id);
      return { outcome: "duplicate_pending_review" };
    }

    const student = existingStudent;
    const activeClass = await resolveActiveClass(payload.county, payload.classId, source);

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

    const pdfStorageKey = await stampPacket(student.id, student.studentId, payload);

    await tryLogAuditEvent({
      actorId: null,
      actorRole: "system",
      action: "student.intake.updated",
      targetType: "student",
      targetId: student.id,
      summary: `Staff-authenticated intake updated records for existing student ${student.studentId}.`,
      metadata: { county: payload.county, source },
    });

    return {
      outcome: "updated",
      studentDbId: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      spokesRecordId: spokesRecord.id,
      classId: activeClass?.id ?? null,
      className: activeClass?.name ?? null,
      orientationInitialized: true,
      pdfStorageKey,
    };
  }

  // --- Path B: Brand New Student ---
  const activeClass = await resolveActiveClass(payload.county, payload.classId, source);
  const newStudentId = await generateUniqueStudentId(payload.firstName, payload.lastName);
  const displayName = `${payload.firstName} ${payload.lastName}`;

  // Only the staff door mints a credential. The public door creates the
  // account with no password hash at all — login treats a null hash as invalid
  // credentials (src/app/api/auth/login/route.ts), so the account is unusable
  // until staff issues a password out of band, and there is no secret in scope
  // for the anonymous response to print (review finding B2).
  const temporaryPassword = source === "staff" ? generateTemporaryPassword() : null;
  const passwordHash = temporaryPassword ? hashPassword(temporaryPassword).hash : null;

  const { student, spokesRecord } = await prisma.$transaction(async (tx) => {
    // 1. Create Student
    const createdStudent = await tx.student.create({
      data: {
        studentId: newStudentId,
        displayName,
        email: normalizedEmail,
        passwordHash,
        // Either somebody else chose this account's password, or it has none
        // yet. Both mean the student has not set one.
        mustChangePassword: true,
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
      // A checkbox on a web form is the student's claim, not a staff member's
      // sign-off. This used to write completed + verificationStatus "verified"
      // + verifiedBy "system:intake_webhook", which walked the whole intake
      // cohort straight past the human-verification layer the program treats
      // as load-bearing (review finding M6). A signed consent is now recorded
      // the way every other honor-system step is: "pending", awaiting staff
      // (src/lib/orientation-completion.ts).
      const consentAttested = Boolean(
        payload.ferpaConsentSigned || payload.policyAcknowledgmentSigned,
      );

      const progressEntries = orientationItems.map((item) => {
        const attested = consentAttested && isConsentItem(item.label, item.description);

        return {
          studentId: createdStudent.id,
          itemId: item.id,
          completed: false,
          completedAt: null,
          verificationStatus: attested ? "pending" : null,
          verifiedAt: null,
          verifiedBy: null,
        };
      });

      await tx.orientationProgress.createMany({
        data: progressEntries,
      });
    }

    return { student: createdStudent, spokesRecord: createdSpokes };
  }, { maxWait: 10000, timeout: 25000 });

  // prismaAdmin skips the write-through extension, so the orientation rows
  // written above must drop the student's cached chat context by hand.
  invalidateChatContext(student.id);

  // 5. Generate & stamp official PDF packet
  const pdfStorageKey = await stampPacket(student.id, student.studentId, payload);

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
      enrolled: Boolean(activeClass),
      source,
      credentialIssued: Boolean(temporaryPassword),
      pdfGenerated: Boolean(pdfStorageKey),
    },
  });

  return {
    outcome: "provisioned",
    studentDbId: student.id,
    studentId: student.studentId,
    displayName: student.displayName,
    temporaryPassword,
    spokesRecordId: spokesRecord.id,
    classId: activeClass?.id ?? null,
    className: activeClass?.name ?? null,
    orientationInitialized: true,
    pdfStorageKey,
  };
}
