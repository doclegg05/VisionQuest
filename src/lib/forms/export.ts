import { csvCell } from "@/lib/csv";
import type { FieldDef, FormTemplateSchema } from "@/lib/forms/schema";

export interface ExportableResponse {
  id: string;
  status: string;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  answers: unknown;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
  classContext: {
    classId: string | null;
    className: string | null;
    programType: string | null;
  };
}

const METADATA_COLUMNS = [
  "responseId",
  "studentId",
  "studentName",
  "classId",
  "className",
  "programType",
  "status",
  "submittedAt",
  "createdAt",
  "updatedAt",
] as const;

/**
 * RFC 4180 CSV escaping: wrap in double quotes if the field contains comma,
 * quote, CR, or LF; escape embedded quotes by doubling them.
 */
// VQ-R-014: the previous local csvEscape quoted commas/quotes but never
// neutralized =+-@ formula prefixes, leaving form-response and coordinator
// exports open to CSV formula injection. All cells now route through the
// formula-safe shared escaper.

export function buildHeaderRow(schema: FormTemplateSchema): string {
  const fieldKeys = schema.map((field) => field.key);
  return [...METADATA_COLUMNS, ...fieldKeys].map(csvCell).join(",");
}

export function buildResponseRow(
  schema: FormTemplateSchema,
  response: ExportableResponse,
): string {
  const answers = (response.answers ?? {}) as Record<string, unknown>;
  const metadata: Record<(typeof METADATA_COLUMNS)[number], string> = {
    responseId: response.id,
    studentId: response.student.studentId,
    studentName: response.student.displayName,
    classId: response.classContext.classId ?? "",
    className: response.classContext.className ?? "",
    programType: response.classContext.programType ?? "",
    status: response.status,
    submittedAt: response.submittedAt?.toISOString() ?? "",
    createdAt: response.createdAt.toISOString(),
    updatedAt: response.updatedAt.toISOString(),
  };
  const meta = METADATA_COLUMNS.map((key) => csvCell(metadata[key]));
  const values = schema.map((field) => csvCell(formatAnswer(field, answers[field.key])));
  return [...meta, ...values].join(",");
}

function formatAnswer(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (field.type) {
    case "multiselect":
      return Array.isArray(value) ? value.join("; ") : String(value);
    case "checkbox":
      return value ? "true" : "false";
    case "attachment":
      if (typeof value === "object" && value !== null && "fileId" in (value as Record<string, unknown>)) {
        return String((value as { fileId: string }).fileId);
      }
      return "";
    default:
      return typeof value === "string" ? value : String(value);
  }
}

/**
 * Stream CSV rows for large exports. Consumers wrap with a TextEncoder and pipe
 * to a Response body. Chunk size is rows-per-yield, not bytes; 500 rows matches
 * plan Risk #2 mitigation.
 */
export async function* streamResponsesAsCsv(
  schema: FormTemplateSchema,
  responses: AsyncIterable<ExportableResponse>,
): AsyncGenerator<string> {
  yield `${buildHeaderRow(schema)}\n`;
  for await (const response of responses) {
    yield `${buildResponseRow(schema, response)}\n`;
  }
}
