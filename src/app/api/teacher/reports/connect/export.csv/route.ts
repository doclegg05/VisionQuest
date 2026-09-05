import { z } from "zod";

import { badRequest, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent, recordStudentView } from "@/lib/audit";
import { buildDohsExportCsv, dohsExportFilename } from "@/lib/connect/dohs-export-shared";
import { fetchDohsExport } from "@/lib/connect/dohs-export";

/**
 * GET /api/teacher/reports/connect/export.csv — the DoHS-facing export
 * (Match & Connect Task 6.2).
 *
 * `classId` is validated against `assertClassIsManaged` inside
 * `fetchDohsExport` — an instructor typing another class's id here 404s
 * (see that function's header for why the wider `assertStaffCanManageClass`
 * would be the wrong check here).
 *
 * Every exported row is a staff read of a student's data, so each one goes
 * through `recordStudentView` (fire, don't await individually — the
 * `Promise.allSettled` convention from `batch-workforce-wv/route.ts`). The
 * export itself is audit-logged with the actor, class, and row count — never
 * student ids (.claude/rules/security.md).
 */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional();

const querySchema = z.object({
  classId: z.string().cuid("Invalid classId.").optional(),
  from: dateOnly,
  to: dateOnly,
});

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    classId: url.searchParams.get("classId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid filter.");
  }
  const query = parsed.data;

  const { rows, studentIds } = await fetchDohsExport(session, {
    classId: query.classId,
    from: query.from,
    to: query.to,
  });

  await Promise.allSettled(
    studentIds.map((studentId) =>
      recordStudentView({
        actorId: session.id,
        actorRole: session.role,
        targetStudentId: studentId,
        surface: "export",
      }),
    ),
  );

  const filename = dohsExportFilename(new Date());

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "connect.dohs_export.exported",
    targetType: "connect_dohs_export",
    targetId: filename,
    summary: `Exported ${rows.length} DoHS statistical-report rows.`,
    metadata: { rowCount: rows.length, classId: query.classId ?? null, from: query.from ?? null, to: query.to ?? null },
  });

  return new Response(buildDohsExportCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A PII-bearing export must never be cached by an intermediary or the
      // browser (precedent: teacher/forms/[templateId]/export/route.ts).
      "Cache-Control": "no-store",
    },
  });
});
