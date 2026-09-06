import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, notFound, rateLimited, withTeacherAuth } from "@/lib/api-error";
import { recordStudentView } from "@/lib/audit";
import { listConnectClasses } from "@/lib/connect/classes";
import { ALLOWED_COLUMNS } from "@/lib/connect/workforce-batch";
import { selectBatchStudents } from "@/lib/connect/workforce-batch-query";
import { rateLimit } from "@/lib/rate-limit";

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
 *
 * It is rate-limited even so. It still puts a class roster of names on screen
 * and still writes audit rows, so an unbounded loop over class ids would be a
 * quiet enumeration of the program with the download's ceiling untouched. The
 * bucket is roomier than the export's because previewing is the safe habit the
 * flow is trying to encourage.
 */

/** Roomy on purpose: a preview is the step we WANT taken before every export. */
const PREVIEW_LIMIT = 60;
const PREVIEW_WINDOW_MS = 60 * 60 * 1000;

const querySchema = z.object({ classId: z.string().cuid("Pick a class.") });

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ classId: url.searchParams.get("classId") ?? "" });
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Pick a class.");
  }

  // The class must be one the caller INSTRUCTS — `listConnectClasses`, not
  // `listManagedClasses`, which hands a plain teacher the whole program. A
  // class outside it is "not found" rather than "forbidden", because the
  // caller should not learn it exists.
  const managed = await listConnectClasses(session, { includeArchived: true });
  const spokesClass = managed.find((row) => row.id === parsed.data.classId);
  if (!spokesClass) throw notFound("That class wasn't found.");

  // After the ownership check, so a refused class never consumes the bucket,
  // and keyed by session for the same reason as the export: a classroom shares
  // one IP.
  const limit = await rateLimit(
    `connect:workforce-preview:${session.id}`,
    PREVIEW_LIMIT,
    PREVIEW_WINDOW_MS,
  );
  if (!limit.success) {
    throw rateLimited("That is a lot of previews. Try again in an hour.");
  }

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
