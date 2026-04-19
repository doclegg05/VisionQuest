import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fieldDefSchema,
  formTemplateSchemaSchema,
  responseReviewSchema,
  templateCreateSchema,
  validateAnswersAgainstSchema,
  type FormTemplateSchema,
} from "./schema";

describe("fieldDefSchema", () => {
  it("accepts a text field with maxLength", () => {
    const parsed = fieldDefSchema.safeParse({
      key: "name",
      label: "Full name",
      type: "text",
      required: true,
      maxLength: 80,
    });
    assert.equal(parsed.success, true);
  });

  it("rejects an unknown field type", () => {
    const parsed = fieldDefSchema.safeParse({
      key: "x",
      label: "X",
      type: "radar",
      required: false,
    });
    assert.equal(parsed.success, false);
  });

  it("rejects a field key that starts with a digit", () => {
    const parsed = fieldDefSchema.safeParse({
      key: "9field",
      label: "Bad",
      type: "text",
    });
    assert.equal(parsed.success, false);
  });

  it("requires at least one option on select", () => {
    const parsed = fieldDefSchema.safeParse({
      key: "pick",
      label: "Pick",
      type: "select",
      options: [],
    });
    assert.equal(parsed.success, false);
  });
});

describe("formTemplateSchemaSchema", () => {
  it("rejects duplicate field keys", () => {
    const result = formTemplateSchemaSchema.safeParse([
      { key: "x", label: "X1", type: "text", required: false },
      { key: "x", label: "X2", type: "text", required: false },
    ]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.issues[0]?.message ?? "", /Duplicate/);
    }
  });

  it("rejects an empty schema", () => {
    const result = formTemplateSchemaSchema.safeParse([]);
    assert.equal(result.success, false);
  });
});

describe("templateCreateSchema", () => {
  it("accepts a minimal valid template payload", () => {
    const parsed = templateCreateSchema.safeParse({
      title: "Intake",
      schema: [{ key: "name", label: "Name", type: "text", required: true }],
    });
    assert.equal(parsed.success, true);
  });

  it("rejects an invalid programType", () => {
    const parsed = templateCreateSchema.safeParse({
      title: "Intake",
      programTypes: ["bogus"],
      schema: [{ key: "x", label: "X", type: "text", required: false }],
    });
    assert.equal(parsed.success, false);
  });
});

describe("responseReviewSchema", () => {
  it("accepts a reviewed action with no notes", () => {
    const parsed = responseReviewSchema.safeParse({ status: "reviewed" });
    assert.equal(parsed.success, true);
  });

  it("requires notes for needs_changes", () => {
    const parsed = responseReviewSchema.safeParse({ status: "needs_changes" });
    assert.equal(parsed.success, false);
  });

  it("accepts needs_changes with notes", () => {
    const parsed = responseReviewSchema.safeParse({
      status: "needs_changes",
      reviewerNotes: "Please clarify question 3.",
    });
    assert.equal(parsed.success, true);
  });
});

describe("validateAnswersAgainstSchema", () => {
  const schema: FormTemplateSchema = [
    { key: "name", label: "Name", type: "text", required: true, maxLength: 10 },
    { key: "age", label: "Age", type: "number", required: false, min: 0, max: 150 },
    {
      key: "program",
      label: "Program",
      type: "select",
      required: true,
      options: ["spokes", "adult_ed"],
    },
    { key: "interests", label: "Interests", type: "multiselect", required: false, options: ["a", "b"] },
    { key: "agreed", label: "Agreed", type: "checkbox", required: false },
    { key: "doc", label: "Attachment", type: "attachment", required: false },
  ];

  it("accepts a complete valid response", () => {
    const out = validateAnswersAgainstSchema(schema, {
      name: "Alice",
      age: 30,
      program: "spokes",
      interests: ["a"],
      agreed: true,
      doc: { fileId: "file_abc" },
    });
    assert.equal(out.name, "Alice");
    assert.equal(out.program, "spokes");
  });

  it("rejects missing required field on full validation", () => {
    assert.throws(() =>
      validateAnswersAgainstSchema(schema, { age: 22 }),
    );
  });

  it("accepts partial draft without required fields", () => {
    const out = validateAnswersAgainstSchema(schema, { age: 22 }, { partial: true });
    assert.equal(out.age, 22);
  });

  it("rejects text over maxLength", () => {
    assert.throws(() =>
      validateAnswersAgainstSchema(schema, {
        name: "TooLongNameIndeed",
        program: "spokes",
      }),
    );
  });

  it("rejects number above max", () => {
    assert.throws(() =>
      validateAnswersAgainstSchema(schema, { name: "A", age: 9999, program: "spokes" }),
    );
  });

  it("rejects select value not in options", () => {
    assert.throws(() =>
      validateAnswersAgainstSchema(schema, {
        name: "A",
        program: "ietp",
      }),
    );
  });

  it("rejects multiselect containing an unknown option", () => {
    assert.throws(() =>
      validateAnswersAgainstSchema(schema, {
        name: "A",
        program: "spokes",
        interests: ["a", "z"],
      }),
    );
  });

  it("strips unknown answer keys", () => {
    const out = validateAnswersAgainstSchema(
      schema,
      { name: "A", program: "spokes", extra: "ignored" },
    );
    assert.equal("extra" in out, false);
  });

  it("rejects attachment without fileId", () => {
    assert.throws(() =>
      validateAnswersAgainstSchema(
        schema,
        { name: "A", program: "spokes", doc: { notFile: "x" } },
        { partial: true },
      ),
    );
  });
});
