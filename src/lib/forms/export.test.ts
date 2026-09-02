import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildHeaderRow,
  buildResponseRow,
  type ExportableResponse,
} from "./export";
import { type FormTemplateSchema } from "./schema";

// Cell rendering used to live in an exported csvEscape here; it now delegates
// to escapeCsvValue (src/lib/csv.ts), so its RFC 4180 behaviors are pinned at
// the row-builder surface the routes actually call.
describe("cell rendering through the row builders", () => {
  const schema: FormTemplateSchema = [
    { key: "note", label: "Note", type: "text", required: false, maxLength: 200 },
  ];
  const response = (note: unknown): ExportableResponse => ({
    id: "r0",
    status: "submitted",
    submittedAt: null,
    createdAt: new Date("2026-04-17T10:00:00Z"),
    updatedAt: new Date("2026-04-18T12:00:00Z"),
    answers: { note },
    student: { id: "stu0", studentId: "STU-000", displayName: "Plain" },
    classContext: { classId: null, className: null, programType: null },
  });
  const lastCell = (note: unknown) => {
    const row = buildResponseRow(schema, response(note));
    return row.slice(row.lastIndexOf(",") + 1);
  };

  it("returns the raw value when no special characters", () => {
    assert.equal(lastCell("plain"), "plain");
  });

  it("wraps and doubles embedded quotes", () => {
    assert.ok(buildResponseRow(schema, response('she said "hi"')).endsWith('"she said ""hi"""'));
  });

  it("wraps values containing commas", () => {
    assert.ok(buildResponseRow(schema, response("one,two")).endsWith('"one,two"'));
  });

  it("wraps values containing newlines and carriage returns", () => {
    assert.ok(buildResponseRow(schema, response("line1\nline2")).endsWith('"line1\nline2"'));
    assert.ok(buildResponseRow(schema, response("line1\rline2")).endsWith('"line1\rline2"'));
  });

  it("renders null answers and null class context as empty cells", () => {
    const row = buildResponseRow(schema, response(null));
    assert.ok(row.endsWith("2026-04-18T12:00:00.000Z,"), row);
    assert.ok(row.includes("Plain,,,,submitted"), "null classId/className/programType render empty");
  });
});

describe("buildHeaderRow + buildResponseRow", () => {
  const schema: FormTemplateSchema = [
    { key: "name", label: "Name", type: "text", required: true, maxLength: 80 },
    { key: "interests", label: "Interests", type: "multiselect", required: false, options: ["a", "b"] },
    { key: "agreed", label: "Agreed", type: "checkbox", required: false },
  ];

  const baseResponse: ExportableResponse = {
    id: "r1",
    status: "submitted",
    submittedAt: new Date("2026-04-18T12:00:00Z"),
    createdAt: new Date("2026-04-17T10:00:00Z"),
    updatedAt: new Date("2026-04-18T12:00:00Z"),
    answers: { name: "Alice", interests: ["a", "b"], agreed: true },
    student: { id: "stu1", studentId: "STU-001", displayName: "Alice" },
    classContext: { classId: "cls1", className: "SPOKES A", programType: "spokes" },
  };

  it("header row begins with metadata columns + field keys", () => {
    const header = buildHeaderRow(schema);
    assert.ok(header.startsWith("responseId,studentId,studentName,classId,className,programType,status,submittedAt,createdAt,updatedAt,"));
    assert.ok(header.endsWith("name,interests,agreed"));
  });

  it("response row serializes multiselect with semicolons and checkbox as true/false", () => {
    const row = buildResponseRow(schema, baseResponse);
    const cells = row.split(",");
    const nameIdx = buildHeaderRow(schema).split(",").indexOf("name");
    assert.equal(cells[nameIdx], "Alice");
    assert.equal(cells[cells.length - 2], "a; b");
    assert.equal(cells[cells.length - 1], "true");
  });

  it("response row escapes commas inside answer values", () => {
    const row = buildResponseRow(schema, {
      ...baseResponse,
      answers: { name: "Smith, John", interests: [], agreed: false },
    });
    assert.ok(row.includes('"Smith, John"'));
  });

  it("missing attachment answer renders empty cell", () => {
    const attachmentSchema: FormTemplateSchema = [
      { key: "doc", label: "Attachment", type: "attachment", required: false },
    ];
    const row = buildResponseRow(attachmentSchema, { ...baseResponse, answers: {} });
    const cells = row.split(",");
    assert.equal(cells[cells.length - 1], "");
  });
});

// Review F13 / API-S-03 (2026-09-01): a cell that opens with a formula
// trigger must leave the exporter neutralized, exactly as the two safe export
// paths already do through escapeCsvValue. Executed on fixture rows, not on
// the escaper alone, because the row builders are what the routes call.
describe("formula injection is neutralized in exported rows", () => {
  const schema: FormTemplateSchema = [
    { key: "eq", label: "Eq", type: "text", required: false, maxLength: 200 },
    { key: "plus", label: "Plus", type: "text", required: false, maxLength: 200 },
    { key: "minus", label: "Minus", type: "text", required: false, maxLength: 200 },
    { key: "at", label: "At", type: "text", required: false, maxLength: 200 },
    { key: "tab", label: "Tab", type: "text", required: false, maxLength: 200 },
    { key: "cr", label: "CR", type: "text", required: false, maxLength: 200 },
  ];

  const hostile: ExportableResponse = {
    id: "r-hostile",
    status: "submitted",
    submittedAt: new Date("2026-09-01T12:00:00Z"),
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: new Date("2026-09-01T12:00:00Z"),
    answers: {
      eq: "=cmd|'/c calc'!A1",
      plus: "+SUM(A1:A9)",
      minus: "-2+3",
      at: "@SUM(A1)",
      tab: "\t=1+1",
      cr: "\r=1+1",
    },
    student: { id: "stu-hostile", studentId: "STU-666", displayName: "=HYPERLINK(\"http://evil\")" },
    classContext: { classId: "cls1", className: "SPOKES A", programType: "spokes" },
  };

  /** Split a fixture row (no commas in any cell) and drop RFC 4180 quoting. */
  function cells(row: string): string[] {
    return row.split(",").map((cell) =>
      cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell,
    );
  }

  it("prefixes every formula-leading answer with a quote", () => {
    const header = buildHeaderRow(schema).split(",");
    const row = cells(buildResponseRow(schema, hostile));
    for (const key of ["eq", "plus", "minus", "at", "tab", "cr"]) {
      const cell = row[header.indexOf(key)];
      assert.ok(cell.startsWith("'"), `${key} cell should be neutralized, got ${JSON.stringify(cell)}`);
    }
    assert.equal(row[header.indexOf("eq")], "'=cmd|'/c calc'!A1");
    assert.equal(row[header.indexOf("minus")], "'-2+3");
  });

  it("neutralizes metadata cells such as a hostile student display name", () => {
    const header = buildHeaderRow(schema).split(",");
    const row = cells(buildResponseRow(schema, hostile));
    assert.equal(row[header.indexOf("studentName")], "'=HYPERLINK(\"http://evil\")");
  });

  it("neutralizes a hostile field key in the header row", () => {
    const hostileSchema: FormTemplateSchema = [
      { key: "=SUM(1+1)", label: "Injected", type: "text", required: false, maxLength: 80 },
    ];
    const header = cells(buildHeaderRow(hostileSchema));
    assert.equal(header[header.length - 1], "'=SUM(1+1)");
  });
});
