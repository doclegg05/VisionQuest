import { NextResponse } from "next/server";
import { z } from "zod";

import { notFound, rateLimited, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent, recordStudentView } from "@/lib/audit";
import { listManagedClasses } from "@/lib/classroom";
import { batchFilename, buildWorkforceBatchCsv } from "@/lib/connect/workforce-batch";
import { selectBatchStudents } from "@/lib/connect/workforce-batch-query";
import { rateLimit } from "@/lib/rate-limit";
import { parseBody } from "@/lib/schemas";

/**
 * The WorkForce WV batch: one class's ready, consented students as a CSV for
 * the Business Services Rep (Match & Connect Task 3.4).
 *
 * POST, not GET, and that is a security property rather than a style choice.
 * A GET that writes audit rows and assembles a file of student names can be
 * fired by any cross-site image tag; POST goes through the Origin-checking
 * CSRF middleware. GET on this path is 405 — see the handler below, which
 * exists so the failure is explicit rather than a Next.js default.
 *
 * Everything about who is included lives in selectBatchStudents: ready
 * (`readinessScore >= READY_TO_WORK_SCORE`) AND consented (an active
 * `employer_referral` record). The preview endpoint runs the same function, so
 * the confirm dialog and the file can never disagree.
 *
 * The class is required. A program-wide export is a far bigger disclosure than
 * anyone means to make with one tap.
 */

/** Five exports an hour per staff session. This is a rare, deliberate act. */
const EXPORT_LIMIT = 5;
const EXPORT_WINDOW_MS = 60 * 60 * 1000;

const bodySchema = z.object({ classId: z.string().cuid("Pick a class.") }).strict();

export const POST = withTeacherAuth(async (session, req: Request) => {
  const { classId } = await parseBody(req, bodySchema);

  const managed = await listManagedClasses(session, { includeArchived: true });
  const spokesClass = managed.find((row) => row.id === classId);
  if (!spokesClass) throw notFound("That class wasn't found.");

  // Keyed by session, not by IP: a shared classroom network is one IP, and the
  // thing being limited is one staff member's exports.
  const limit = await rateLimit(
    `connect:workforce-batch:${session.id}`,
    EXPORT_LIMIT,
    EXPORT_WINDOW_MS,
  );
  if (!limit.success) {
    throw rateLimited("You have exported this a few times already. Try again in an hour.");
  }

  const selection = await selectBatchStudents(spokesClass.id);

  // Audits cover the EXPORTED rows only. A student excluded for no consent has
  // not been disclosed, and recording a view of them here would be both a
  // false ledger entry and a second small leak of who they are.
  await Promise.allSettled(
    selection.includedIds.map((studentId) =>
      recordStudentView({
        actorId: session.id,
        actorRole: session.role,
        targetStudentId: studentId,
        surface: "export",
      }),
    ),
  );

  const filename = batchFilename(new Date());

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "connect.workforce_batch.exported",
    targetType: "connect_batch",
    targetId: filename,
    summary: `Exported ${selection.rows.length} students for WorkForce WV.`,
    // The count is the disclosure's size; names belong in the file, not the
    // ledger (.claude/rules/security.md: who did what, not the payload).
    metadata: {
      studentCount: selection.rows.length,
      classId: spokesClass.id,
      excludedNotReady: selection.excludedNotReady,
      excludedNoConsent: selection.excludedNoConsent,
    },
  });

  return new Response(buildWorkforceBatchCsv(selection.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

/**
 * Explicitly 405 rather than letting the route 404 or fall through. A GET here
 * is either an old bookmark or a cross-site attempt at the pre-fix behaviour,
 * and both deserve a clear answer.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Use POST to download this file." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
