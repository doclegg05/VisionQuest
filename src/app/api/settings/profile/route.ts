import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, badRequest } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { splitDisplayName } from "@/lib/spokes";

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
    select: { birthDate: true },
  });
  return NextResponse.json({ birthDate: toIsoDate(record?.birthDate) });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, profileSchema);

  if (body.birthDate === undefined) {
    return NextResponse.json({ ok: true, updated: false });
  }

  const birthDate = parseBirthDate(body.birthDate);

  // Upsert — most SPOKES students already have a SpokesRecord from the
  // referral workflow. For a student who came in through another path,
  // create a minimal record with a best-effort name split. Teachers can
  // correct the split through the Spokes workspace.
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { displayName: true, email: true },
  });
  if (!student) throw badRequest("Student not found");

  const { firstName, lastName } = splitDisplayName(student.displayName);

  const updated = await prisma.spokesRecord.upsert({
    where: { studentId: session.id },
    update: { birthDate },
    create: {
      studentId: session.id,
      firstName,
      lastName,
      referralEmail: student.email,
      status: "referred",
      birthDate,
    },
    select: { birthDate: true },
  });

  return NextResponse.json({
    ok: true,
    updated: true,
    birthDate: toIsoDate(updated.birthDate),
  });
});
