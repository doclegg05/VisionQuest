import { badRequest, forbidden, notFound, withTeacherAuth } from "@/lib/api-error";
import { canManageAnyClass } from "@/lib/classroom";
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

export const GET = withTeacherAuth(async (session, req: Request, ctx: RouteContext) => {
  if (!canManageAnyClass(session.role)) {
    throw forbidden("CSV export is restricted to admins and coordinators.");
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

  const encoder = new TextEncoder();
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
        }

        cursor = page.at(-1)?.id;
        if (page.length < PAGE_SIZE) break;
      }

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
