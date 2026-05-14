import type { AgentTool, JsonSchemaProperty } from "./types";

type ValidationPath = string;

export type ToolArgValidationResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

export function validateToolArgs(
  tool: AgentTool,
  rawArgs: unknown,
): ToolArgValidationResult {
  if (!isPlainRecord(rawArgs)) {
    return { ok: false, error: "Tool arguments must be a JSON object." };
  }

  const declaredKeys = new Set(Object.keys(tool.parameters.properties));
  for (const key of Object.keys(rawArgs)) {
    if (!declaredKeys.has(key)) {
      return {
        ok: false,
        error: `Unsupported argument "${key}" for ${tool.name}.`,
      };
    }
  }

  for (const key of tool.parameters.required ?? []) {
    const value = rawArgs[key];
    if (value === undefined || value === null || value === "") {
      return {
        ok: false,
        error: `Missing required argument "${key}" for ${tool.name}.`,
      };
    }
  }

  const validated: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(tool.parameters.properties)) {
    const value = rawArgs[key];
    if (value === undefined) continue;

    const result = validateValue(value, schema, key);
    if (!result.ok) return result;
    validated[key] = value;
  }

  return { ok: true, args: validated };
}

function validateValue(
  value: unknown,
  schema: JsonSchemaProperty,
  path: ValidationPath,
): ToolArgValidationResult {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        return typeError(path, "string");
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return {
          ok: false,
          error: `${path} must be one of: ${schema.enum.join(", ")}.`,
        };
      }
      return { ok: true, args: {} };

    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return typeError(path, "number");
      }
      return { ok: true, args: {} };

    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return typeError(path, "integer");
      }
      return { ok: true, args: {} };

    case "boolean":
      if (typeof value !== "boolean") {
        return typeError(path, "boolean");
      }
      return { ok: true, args: {} };

    case "array":
      if (!Array.isArray(value)) {
        return typeError(path, "array");
      }
      if (schema.items) {
        for (let index = 0; index < value.length; index += 1) {
          const result = validateValue(value[index], schema.items, `${path}[${index}]`);
          if (!result.ok) return result;
        }
      }
      return { ok: true, args: {} };

    case "object":
      if (!isPlainRecord(value)) {
        return typeError(path, "object");
      }
      return { ok: true, args: {} };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function typeError(path: ValidationPath, expected: string): ToolArgValidationResult {
  const article = /^[aeiou]/i.test(expected) ? "an" : "a";
  return { ok: false, error: `${path} must be ${article} ${expected}.` };
}
