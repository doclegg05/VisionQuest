import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildHeaderRow,
  buildResponseRow,
  csvEscape,
  type ExportableResponse,
} from "./export";
import { type FormTemplateSchema } from "./schema";

describe("csvEscape", () => {
  it("returns the raw value when no special characters", () => {
    assert.equal(csvEscape("plain"), "plain");
  });

  it("wraps and doubles embedded quotes", () => {
    assert.equal(csvEscape('she said "hi"'), '"she said ""hi"""');
  });

  it("wraps values containing commas", () => {
    assert.equal(csvEscape("one,two"), '"one,two"');
  });

  it("wraps values containing newlines", () => {
    assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
  });

  it("joins arrays with semicolons", () => {
    assert.equal(csvEscape(["a", "b", "c"]), "a; b; c");
  });

  it("renders null/undefined as empty string", () => {
    assert.equal(csvEscape(null), "");
    assert.equal(csvEscape(undefined), "");
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
