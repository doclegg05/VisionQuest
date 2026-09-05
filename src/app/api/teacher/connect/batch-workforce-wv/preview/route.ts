import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { listManagedClasses } from "@/lib/classroom";
import { ALLOWED_COLUMNS } from "@/lib/connect/workforce-batch";
import { selectBatchStudents } from "@/lib/connect/workforce-batch-query";

/**
 * What the WorkForce WV export will contain, shown BEFORE it runs
 * (UX review CRITICAL #1, security review C1(d)).
 *
 * The console used to trigger the export from a bare link: one tap put a file
 * of TANF students' names on disk and a disclosure in the audit log, with
 * nothing shown first. This is the other half of that fix — the instructor
 * sees exactly who is included, exactly which fields go out, and how many
 * students were left out and why, and only then confirms.
 *
 * Two rules this route follows and the download does not:
 *   - It writes NO export audit event. Nothing has left the program yet, and a
 *     ledger row claiming otherwise would be a false record of a disclosure.
 *   - The excluded are COUNTED, never named. A student who has not consented
 *     to being referred has not consented to appearing on this screen either.
 */

const querySchema = z.object({ classId: z.string().cuid("Pick a class.") });

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ classId: url.searchParams.get("classId") ?? "" });
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Pick a class.");
  }

  // The class must be one of the caller's own. `listManagedClasses` is the
  // repo's single answer to that question; a class outside it is "not found"
  // rather than "forbidden", because the caller should not learn it exists.
  const managed = await listManagedClasses(session, { includeArchived: true });
  const spokesClass = managed.find((row) => row.id === parsed.data.classId);
  if (!spokesClass) throw notFound("That class wasn't found.");

  const selection = await selectBatchStudents(spokesClass.id);

  // A preview puts names on screen, which is a staff read of student data even
  // though nothing is exported. Sampled once per actor/student/day, so opening
  // the dialog repeatedly does not flood the ledger.
  await Promise.allSettled(
    selection.includedIds.map((studentId) =>
      recordStudentView({
        actorId: session.id,
        actorRole: session.role,
        targetStudentId: studentId,
        surface: "student_detail",
      }),
    ),
  );

  return NextResponse.json({
    className: spokesClass.name,
    count: selection.rows.length,
    names: selection.rows.map((row) => row.displayName),
    fields: [...ALLOWED_COLUMNS],
    excludedNotReady: selection.excludedNotReady,
    excludedNoConsent: selection.excludedNoConsent,
  });
});
