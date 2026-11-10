/**
 * Which admin-client findUnique calls Prisma 6's DataLoader sends as one
 * statement. Test support for the readiness query counts; used by
 * `src/lib/query-counter.test-support.ts`.
 */
import { Prisma } from "@prisma/client";

const COMPACTABLE_ARGUMENTS: ReadonlySet<string> = new Set(["where", "select", "include"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The argument shape Prisma batches on: keys sorted and nested, values
 * ignored (runtime/library.js `Co`). `false` is kept, so a deselected field
 * never matches a selected one; that can only split a group, never merge one.
 */
export function argumentShape(value: unknown): string {
  if (!isRecord(value) && !Array.isArray(value)) return "";
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `(${entries.map(([key, inner]) => {
    if (typeof inner === "object" && inner !== null) return `(${key} ${argumentShape(inner)})`;
    return inner === false ? `${key}:false` : key;
  }).join(" ")})`;
}

function clientCase(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/** model (client casing) -> its single-field `@id` and `@unique` fields, from Prisma's DMMF. */
const UNIQUE_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    clientCase(model.name),
    new Set(model.fields.filter((field) => field.isId || field.isUnique).map((field) => field.name)),
  ]),
);

/**
 * A where Prisma's batch was verified to merge: exactly one field, which the
 * schema marks `@id` or `@unique`, holding a string or a number. A second
 * field, a compound key, an operator or a boolean is sent alone.
 */
export function isMergeableWhere(model: string, where: Readonly<Record<string, unknown>>): boolean {
  const entries = Object.entries(where);
  const [only] = entries;
  if (entries.length !== 1 || only === undefined) return false;
  const [field, value] = only;
  const unique = UNIQUE_FIELDS.get(model)?.has(field) ?? false;
  return unique && (typeof value === "string" || typeof value === "number");
}

/**
 * Whether a same-tick group of these calls reaches Postgres as one statement:
 * the engine compacts a findUnique batch into one `WHERE ... IN` select when
 * each where is one plain value on the same unique field. Anything wider, or a
 * call with nested loads, is counted one statement each.
 */
export function isCompactable(model: string, args: unknown, relationLoads: number): boolean {
  if (!isRecord(args) || !isRecord(args.where)) return false;
  if (!Object.keys(args).every((key) => COMPACTABLE_ARGUMENTS.has(key))) return false;
  return isMergeableWhere(model, args.where) && relationLoads === 0;
}
