import { badRequest, forbidden, notFound, withTeacherAuth } from "@/lib/api-error";
import { tryLogAuditEvent } from "@/lib/audit";
import { buildManagedStudentWhere, canPerformElevatedStaffAction } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import {
  buildHeaderRow,
  buildResponseRow,
  type ExportableResponse,
} from "@/lib/forms/export";
import {
  formTemplateSchemaSchema,
  type FormTemplateSchema,
} from "@/lib/forms/schema";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

// Bulk export of official SPOKES/DoHS intake answers. Two gates, both load
// bearing:
//
//   withTeacherAuth              → staff only (teacher OR admin; coordinators
//                                  are refused by the wrapper itself)
//   canPerformElevatedStaffAction → admin/coordinator TIER
//
// Their intersection is admins. Coordinators are named in the tier predicate
// but cannot reach this handler today, and admitting them here would be a
// change of a different size: `rlsContextFor` collapses a coordinator session
// to role="student", and `buildManagedStudentWhere` fails closed for
// coordinators by design (see its Slice D invariant), so a coordinator would
// need an explicitly region-scoped query — the getCoordinatorInterventionQueue
// pattern — not simply a wider role list. Until that exists the honest error
// message is "admins", not "admins and coordinators".
export const GET = withTeacherAuth(async (session, req: Request, ctx: RouteContext) => {
  if (!canPerformElevatedStaffAction(session.role)) {
    throw forbidden("Only admins can export this CSV.");
  }

  const { templateId } = await ctx.params;
  const url = new URL(req.url);

  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, title: true, schema: true, isOfficial: true },
  });
  if (!template) throw notFound("Template not found.");

  const schemaResult = formTemplateSchemaSchema.safeParse(template.schema);
  if (!schemaResult.success) {
    throw badRequest("Template schema is corrupt — unable to export.");
  }
  const schema: FormTemplateSchema = schemaResult.data;

  const rangeFilter = buildRangeFilter(from, to);
  const PAGE_SIZE = 500;

  // App-layer scope, so the query says what RLS would enforce rather than
  // relying on who happens to reach the handler. Archived enrollments and
  // deactivated accounts are included: a submitted official form is a record
  // of something that happened, and dropping it would silently shorten the
  // export. Today (admin only) this resolves to `{ role: "student" }`; if the
  // gate ever widens, the narrowing arrives with it instead of being
  // remembered.
  const managedStudentWhere = buildManagedStudentWhere(session, {
    includeArchivedEnrollments: true,
    includeInactiveAccounts: true,
  });

  const encoder = new TextEncoder();
  let exportedRows = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${buildHeaderRow(schema)}\n`));

      let cursor: string | undefined;
      while (true) {
        const page = await prisma.formResponse.findMany({
          where: {
            templateId,
            ...(rangeFilter ? { submittedAt: rangeFilter } : {}),
            status: { not: "draft" },
            student: managedStudentWhere,
          },
          select: {
            id: true,
            status: true,
            answers: true,
            submittedAt: true,
            createdAt: true,
            updatedAt: true,
            student: {
              select: {
                id: true,
                studentId: true,
                displayName: true,
                classEnrollments: {
                  where: { status: "active" },
                  orderBy: { enrolledAt: "desc" },
                  take: 1,
                  select: {
                    class: {
                      select: { id: true, name: true, programType: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { id: "asc" },
          take: PAGE_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (page.length === 0) break;

        for (const row of page) {
          const enrollment = row.student.classEnrollments[0];
          const exportable: ExportableResponse = {
            id: row.id,
            status: row.status,
            submittedAt: row.submittedAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            answers: row.answers,
            student: {
              id: row.student.id,
              studentId: row.student.studentId,
              displayName: row.student.displayName,
            },
            classContext: {
              classId: enrollment?.class.id ?? null,
              className: enrollment?.class.name ?? null,
              programType: enrollment?.class.programType ?? null,
            },
          };
          controller.enqueue(encoder.encode(`${buildResponseRow(schema, exportable)}\n`));
          exportedRows += 1;
        }

        cursor = page.at(-1)?.id;
        if (page.length < PAGE_SIZE) break;
      }

      // Audited after the rows are counted, so the row count is real rather
      // than intended. AuditLog is admin-only under RLS and lives on the
      // admin client, so a failed write is logged and swallowed rather than
      // tearing down a stream whose bytes have already left (same reasoning
      // as tryLogAuditEvent's doc block). No student identifier in the
      // payload — the template and the count are the record
      // (.claude/rules/security.md, Data Privacy).
      await tryLogAuditEvent({
        actorId: session.id,
        actorRole: session.role,
        action: "teacher.form.export",
        targetType: "form_template",
        targetId: templateId,
        summary: `Exported ${exportedRows} response(s) for form template.`,
        metadata: {
          rowCount: exportedRows,
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
        },
      });

      controller.close();
    },
  });

  const filenameBase = template.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "form";
  const today = new Date().toISOString().slice(0, 10);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildRangeFilter(from: Date | null, to: Date | null) {
  if (!from && !to) return null;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}
