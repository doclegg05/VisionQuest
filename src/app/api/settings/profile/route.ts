import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, badRequest } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { splitDisplayName } from "@/lib/spokes";
import { answersSchema, validateAnswersAgainstSchema } from "@/lib/forms/schema";
import {
  STUDENT_PROFILE_FIELDS,
  studentProfileAnswersToColumns,
  spokesColumnsToStudentProfileAnswers,
} from "@/lib/spokes/student-profile-form";

/**
 * Student self-service profile fields. Currently scoped to birthDate (added
 * as part of the orientation completion prompt, 2026-04-24). Extend this
 * endpoint — don't bolt on separate /api/settings/<field> routes — when new
 * self-editable profile fields come online so the client only ever talks to
 * one settings surface.
 *
 * The `birthDate` column lives on SpokesRecord (the DoHS-reporting record),
 * not on Student. If the student doesn't have a SpokesRecord yet we create
 * one with a best-effort firstName/lastName split — a teacher can correct
 * the split later from SpokesStudentWorkspace if needed.
 *
 * Teachers edit student profiles through /api/teacher/students/[id]/spokes.
 * This endpoint is student-only in the sense that it always writes to
 * `session.id` regardless of the payload; RLS enforces the same invariant.
 */
const profileSchema = z.object({
  // null explicitly clears the field. ISO date only; we reject anything
  // more than 120 years ago or in the future so a fat-fingered year doesn't
  // end up in the DB.
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "birthDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
  // Full in-browser Student Profile submission (orientation wizard).
  // Keyed by STUDENT_PROFILE_FIELDS; validated against that schema below so
  // enum options, lengths, and types are enforced server-side, and only
  // whitelisted keys ever map to SpokesRecord columns.
  profile: answersSchema.optional(),
});

function parseBirthDate(input: string | null): Date | null {
  if (input === null) return null;
  const parsed = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw badRequest("birthDate is not a real date");
  const now = Date.now();
  const oldest = now - 120 * 365 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > now) throw badRequest("birthDate cannot be in the future");
  if (parsed.getTime() < oldest) throw badRequest("birthDate is too far in the past");
  return parsed;
}

function toIsoDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export const GET = withAuth(async (session) => {
  const record = await prisma.spokesRecord.findUnique({
    where: { studentId: session.id },
    select: {
      birthDate: true,
      firstName: true,
      lastName: true,
      county: true,
      householdType: true,
      gender: true,
      race: true,
      ethnicity: true,
      educationalLevel: true,
      referralEmail: true,
    },
  });

  const profile = spokesColumnsToStudentProfileAnswers(record);
  const birthDateIso = toIsoDate(record?.birthDate);
  if (birthDateIso) {
    profile.birth_date = birthDateIso;
  }

  return NextResponse.json({ birthDate: toIsoDate(record?.birthDate), profile });
});

type ProfileRecordData = Partial<{
  firstName: string;
  lastName: string;
  county: string;
  householdType: string;
  gender: string;
  race: string;
  ethnicity: string;
  educationalLevel: string;
  referralEmail: string;
  birthDate: Date | null;
}>;

/**
 * Validate a full profile submission and produce the SpokesRecord column
 * data. Throws badRequest on any invalid option/length/type so the client
 * gets a correctable 400 instead of a 500.
 */
function profileAnswersToRecordData(
  rawAnswers: NonNullable<z.infer<typeof profileSchema>["profile"]>,
): ProfileRecordData {
  let answers;
  try {
    answers = validateAnswersAgainstSchema(STUDENT_PROFILE_FIELDS, rawAnswers);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid profile submission");
  }

  const data: ProfileRecordData = studentProfileAnswersToColumns(answers);

  if (data.referralEmail !== undefined
    && !z.string().email().max(200).safeParse(data.referralEmail).success) {
    throw badRequest("Email address is not valid.");
  }

  const rawBirthDate = answers.birth_date;
  if (typeof rawBirthDate === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawBirthDate)) {
      throw badRequest("Date of birth must be YYYY-MM-DD");
    }
    const parsed = parseBirthDate(rawBirthDate);
    if (parsed) data.birthDate = parsed;
  }

  return data;
}

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, profileSchema);

  if (body.birthDate === undefined && body.profile === undefined) {
    return NextResponse.json({ ok: true, updated: false });
  }

  // Two callers share this endpoint: the legacy birthDate-only prompt and
  // the orientation wizard's full profile form. Both always write to
  // session.id — a smuggled studentId in the payload is never consulted.
  const recordData: ProfileRecordData = body.profile
    ? profileAnswersToRecordData(body.profile)
    : {};

  if (body.birthDate !== undefined) {
    recordData.birthDate = parseBirthDate(body.birthDate);
  }

  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { displayName: true, email: true },
  });
  if (!student) throw badRequest("Student not found");

  // Upsert — most SPOKES students already have a SpokesRecord from the
  // referral workflow. For a student who came in through another path,
  // create a minimal record with a best-effort name split (immediately
  // overridden by submitted first/last name when present). Teachers can
  // correct anything through the Spokes workspace.
  const { firstName, lastName } = splitDisplayName(student.displayName);

  const updated = await prisma.spokesRecord.upsert({
    where: { studentId: session.id },
    update: recordData,
    create: {
      studentId: session.id,
      firstName,
      lastName,
      referralEmail: student.email,
      status: "referred",
      ...recordData,
    },
    select: { birthDate: true },
  });

  return NextResponse.json({
    ok: true,
    updated: true,
    birthDate: toIsoDate(updated.birthDate),
  });
});
