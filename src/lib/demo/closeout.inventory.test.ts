/**
 * The demo closeout's lists against the schema (readiness H10).
 *
 * closeout.ts names tables and columns as plain strings, so the compiler
 * cannot check them. These tests read the schema from Prisma's DMMF and fail
 * when a list names something the schema does not have, and, the other way
 * round, when the schema has a link to Student or SpokesClass that no list
 * mentions. A new student-linked model cannot slip past the tool: adding one
 * fails here until it is deleted by a step, guarded, or kept on purpose.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { CLASS_COLUMNS, DELETE_STEPS, GUARDED_REFS, KEPT_ON_PURPOSE, tableOf } from "./closeout";
import { EDGES, MODELS, modelNamed } from "./closeout.fixtures";

const key = (model: string, column: string) => `${model}.${column}`;

const accountSteps = DELETE_STEPS.filter((step) => step.scope === "account");
const ownedColumns = new Set(accountSteps.flatMap((step) => (step.column ? [key(step.model, step.column)] : [])));
const guardedColumns = new Set(GUARDED_REFS.map((ref) => key(ref.model, ref.column)));
const classColumns = new Set(CLASS_COLUMNS.map((ref) => key(ref.model, ref.column)));
const deletedModels = new Set<string>(DELETE_STEPS.map((step) => step.model));

describe("demo closeout inventory", () => {
  it("classifies every foreign key to Student as deleted with its owner or guarded", () => {
    const unclassified = EDGES.filter((edge) => edge.parent === "Student")
      .map((edge) => key(edge.child, edge.from[0]))
      .filter((column) => !ownedColumns.has(column) && !guardedColumns.has(column));

    assert.deepEqual(unclassified, []);
  });

  it("deletes every model with a relation to Student, or keeps it on purpose with a reason", () => {
    const linked = [...new Set(EDGES.filter((edge) => edge.parent === "Student").map((edge) => edge.child))];
    const unaccounted = linked.filter((model) => !deletedModels.has(model) && !Object.hasOwn(KEPT_ON_PURPOSE, model));

    assert.deepEqual(unaccounted, []);
    for (const [model, reason] of Object.entries(KEPT_ON_PURPOSE)) {
      modelNamed(model);
      assert.ok(reason.trim().length > 20, `${model} needs a reason for being kept`);
    }
  });

  it("deletes every model below Student and the demo class that is not kept on purpose", () => {
    // Rows reached through a parent (a certification's requirements, a class's
    // job listings) have no account column, so the rule above cannot see them.
    const cascades = (parent: string): string[] =>
      EDGES.filter((edge) => edge.parent === parent && edge.onDelete === "Cascade" && edge.child !== parent).map((edge) => edge.child);
    const below = new Set<string>();
    let frontier = [...deletedModels].filter((model) => !Object.hasOwn(KEPT_ON_PURPOSE, model) || model === "SpokesClass");
    while (frontier.length > 0) {
      const next = frontier.flatMap(cascades).filter((model) => !below.has(model));
      next.forEach((model) => below.add(model));
      frontier = [...new Set(next)];
    }

    assert.deepEqual([...below].filter((model) => !deletedModels.has(model)), []);
  });

  it("lists every foreign key to SpokesClass as a class column", () => {
    const unlisted = EDGES.filter((edge) => edge.parent === "SpokesClass")
      .map((edge) => key(edge.child, edge.from[0]))
      .filter((column) => !classColumns.has(column));

    assert.deepEqual(unlisted, []);
  });

  it("classifies every text column with 'student' in its name", () => {
    // A column that holds a student id with no foreign key is invisible to the
    // rules above. The name is the only clue the schema gives.
    const unclassified = MODELS.filter((model) => model.name !== "Student")
      .flatMap((model) => model.fields.filter((field) => field.kind === "scalar" && field.type === "String" && /student/i.test(field.name))
        .map((field) => key(model.name, field.name)))
      .filter((column) => !ownedColumns.has(column) && !guardedColumns.has(column));

    assert.deepEqual(unclassified, []);
  });

  it("names only columns the schema has, each a single text column", () => {
    const named = [
      ...DELETE_STEPS.flatMap((step) => (step.column ? [{ model: step.model, column: step.column }] : [])),
      ...GUARDED_REFS.map((ref) => ({ model: ref.model, column: ref.column })),
      ...GUARDED_REFS.flatMap((ref) => (ref.survives.kind === "ownerKey" ? [{ model: ref.model, column: ref.survives.key }] : [])),
      ...CLASS_COLUMNS,
    ];
    const wrong = named.filter(({ model, column }) => {
      const field = modelNamed(model).fields.find((candidate) => candidate.name === column);
      return !field || field.kind !== "scalar" || field.type !== "String" || field.isList;
    });

    assert.deepEqual(wrong, []);
  });

  it("gives an id column to every model that more than one step deletes from", () => {
    // The preview counts such a model by distinct id, so a row two steps both
    // match is counted once.
    const counts = new Map<string, number>();
    for (const step of DELETE_STEPS) counts.set(step.model, (counts.get(step.model) ?? 0) + 1);
    const withoutId = [...counts].filter(([model, steps]) => steps > 1 && !modelNamed(model).fields.some((field) => field.name === "id"));

    assert.deepEqual(withoutId, []);
  });

  it("names each deleted or guarded column once", () => {
    const all = [...DELETE_STEPS.flatMap((step) => (step.column ? [`${step.scope}:${key(step.model, step.column)}`] : [])),
      ...GUARDED_REFS.map((ref) => `account:${key(ref.model, ref.column)}`)];

    assert.deepEqual(all.filter((entry, index) => all.indexOf(entry) !== index), []);
  });

  it("deletes the accounts last and the demo class just before them", () => {
    assert.deepEqual(DELETE_STEPS.slice(-2).map((step) => step.model), ["SpokesClass", "Student"]);
  });

  it("repeats the demo marker in the statement that deletes accounts", () => {
    // The plan is checked for unmarked accounts before anything is deleted.
    // This is the second lock: the statement itself cannot match one.
    const [accounts] = DELETE_STEPS.slice(-1);

    assert.deepEqual(accounts.where(["an-id"]), { id: { in: ["an-id"] }, demoAccount: { not: null } });
  });

  it("finds a table on the real Prisma client for every model", async () => {
    // Never connects: the client only opens a connection when a query runs.
    const client = new PrismaClient({ datasources: { db: { url: "postgresql://127.0.0.1:1/closeout_inventory" } } });
    try {
      for (const model of MODELS) assert.equal(typeof tableOf(client, model.name).count, "function", model.name);
      assert.throws(() => tableOf(client, "NoSuchModel"), /no table/);
    } finally {
      await client.$disconnect();
    }
  });
});
