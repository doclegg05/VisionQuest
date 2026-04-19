import { z } from "zod";

export const FIELD_TYPES = [
  "text",
  "longText",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "attachment",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const fieldKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/i, "Field key must start with a letter and contain only letters, digits, or underscores.");

const baseField = z.object({
  key: fieldKeySchema,
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
});

export const fieldDefSchema = z.discriminatedUnion("type", [
  baseField.extend({ type: z.literal("text"), maxLength: z.number().int().positive().max(1000).optional() }),
  baseField.extend({ type: z.literal("longText"), maxLength: z.number().int().positive().max(10_000).optional() }),
  baseField.extend({ type: z.literal("number"), min: z.number().optional(), max: z.number().optional() }),
  baseField.extend({ type: z.literal("date") }),
  baseField.extend({
    type: z.literal("select"),
    options: z.array(z.string().min(1).max(200)).min(1).max(50),
  }),
  baseField.extend({
    type: z.literal("multiselect"),
    options: z.array(z.string().min(1).max(200)).min(1).max(50),
  }),
  baseField.extend({ type: z.literal("checkbox") }),
  baseField.extend({ type: z.literal("attachment"), accept: z.array(z.string()).optional() }),
]);

export type FieldDef = z.infer<typeof fieldDefSchema>;

export const formTemplateSchemaSchema = z
  .array(fieldDefSchema)
  .min(1, "Template must have at least one field.")
  .max(100, "Template cannot exceed 100 fields.")
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const [index, field] of fields.entries()) {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate field key "${field.key}".`,
          path: [index, "key"],
        });
      }
      seen.add(field.key);
    }
  });

export type FormTemplateSchema = z.infer<typeof formTemplateSchemaSchema>;

const PROGRAM_TYPE_VALUES = ["spokes", "adult_ed", "ietp"] as const;

export const templateCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  programTypes: z.array(z.enum(PROGRAM_TYPE_VALUES)).max(3).default([]),
  schema: formTemplateSchemaSchema,
  isOfficial: z.boolean().default(false),
});

export const templateUpdateSchema = templateCreateSchema.partial().extend({
  status: z.enum(["active", "archived"]).optional(),
});

export const assignmentCreateSchema = z
  .object({
    scope: z.enum(["class", "student"]),
    targetId: z.string().min(1).max(64),
    dueAt: z.string().datetime().nullish(),
    requiredForCompletion: z.boolean().default(false),
  })
  .strict();

const answerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.object({ fileId: z.string().min(1) }).strict(),
  z.null(),
]);

export const answersSchema = z.record(z.string(), answerValueSchema);
export type Answers = z.infer<typeof answersSchema>;

export const responseUpsertSchema = z.object({
  answers: answersSchema,
});

export const responseReviewSchema = z
  .object({
    status: z.enum(["reviewed", "needs_changes"]),
    reviewerNotes: z.string().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "needs_changes" && !value.reviewerNotes?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reviewer notes are required when marking a response as needs_changes.",
        path: ["reviewerNotes"],
      });
    }
  });

/**
 * Validates a student's submitted answers against a template's schema.
 * Returns the narrowed answers object on success; throws ZodError otherwise.
 * Unknown keys in answers are silently dropped (so renaming a field key doesn't
 * retroactively corrupt older responses, which is the point of Risk #1 in the
 * plan — we lock field keys at publication, but also strip unknowns defensively).
 */
export function validateAnswersAgainstSchema(
  fields: FormTemplateSchema,
  rawAnswers: Answers,
  options: { partial?: boolean } = {},
): Answers {
  const partial = options.partial ?? false;
  const out: Answers = {};
  for (const field of fields) {
    const value = rawAnswers[field.key];
    if (value === undefined || value === null || value === "") {
      if (field.required && !partial) {
        throw new Error(`Field "${field.label}" is required.`);
      }
      continue;
    }
    out[field.key] = validateFieldValue(field, value);
  }
  return out;
}

function validateFieldValue(field: FieldDef, value: unknown): Answers[string] {
  switch (field.type) {
    case "text":
    case "longText": {
      if (typeof value !== "string") throw new Error(`Field "${field.label}" must be a string.`);
      const max = field.maxLength;
      if (max !== undefined && value.length > max) {
        throw new Error(`Field "${field.label}" exceeds ${max} characters.`);
      }
      return value;
    }
    case "number": {
      const num = typeof value === "string" ? Number(value) : value;
      if (typeof num !== "number" || Number.isNaN(num)) {
        throw new Error(`Field "${field.label}" must be a number.`);
      }
      if (field.min !== undefined && num < field.min) {
        throw new Error(`Field "${field.label}" must be >= ${field.min}.`);
      }
      if (field.max !== undefined && num > field.max) {
        throw new Error(`Field "${field.label}" must be <= ${field.max}.`);
      }
      return num;
    }
    case "date": {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new Error(`Field "${field.label}" must be an ISO date string.`);
      }
      return value;
    }
    case "select": {
      if (typeof value !== "string" || !field.options.includes(value)) {
        throw new Error(`Field "${field.label}" has an invalid option.`);
      }
      return value;
    }
    case "multiselect": {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && field.options.includes(entry))) {
        throw new Error(`Field "${field.label}" has one or more invalid options.`);
      }
      return value;
    }
    case "checkbox": {
      if (typeof value !== "boolean") {
        throw new Error(`Field "${field.label}" must be a boolean.`);
      }
      return value;
    }
    case "attachment": {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { fileId?: unknown }).fileId !== "string"
      ) {
        throw new Error(`Field "${field.label}" must reference an uploaded file.`);
      }
      return { fileId: (value as { fileId: string }).fileId };
    }
  }
}
