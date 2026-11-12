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
import { CLASS_COLUMNS, DELETE_STEPS, GUARDED_REFS, KEPT_ON_PURPOSE, SET_NULL_LINKS, UNLINKED_REFS, UNMARKED_ON_DEMO_CLASS, tableOf } from "./closeout";
import { ABOUT_OTHERS } from "./closeout.guards";
import { ORPHAN_PROBES } from "./closeout.orphans";
import { EDGES, MODELS, modelNamed } from "./closeout.fixtures";

const key = (model: string, column: string) => `${model}.${column}`;

/** Column names that may hold a person's id: a student, an actor, an author, an owner, a recipient. */
const PERSON_ID_NAME = /student|(By|ById)$|^(actorId|authorId|ownerId|userId|recipientId|advisorId|subjectId|targetId|toId|fromId)$/i;

/**
 * Columns the name rule matches that never hold a person's id. Each line says
 * what the column holds instead.
 */
const NOT_PERSON_IDS: Readonly<Record<string, string>> = {
  "SageMemoryEdge.fromId": "a SageMemory id, with a foreign key; the memory's own subject is checked",
  "SageMemoryEdge.toId": "a SageMemory id, with a foreign key; the memory's own subject is checked",
  "ProgressionEdge.fromId": "a progression node id in the shared curriculum graph",
  "ProgressionEdge.toId": "a progression node id in the shared curriculum graph",
  "Wager.targetId": "the goal or task a wager is about; the wager itself is deleted with its student",
};

/**
 * Text columns named like a row id (`...Id`) that have no relation, and that
 * no closeout list checks at run time. Each line says why a kept row's value
 * there can never be the id of a row the closeout deletes.
 */
const NOT_ROW_LINKS: Readonly<Record<string, string>> = {
  "Student.studentId": "the login name, not a row id",
  "Student.googleId": "the Google account id, from outside the database",
  "Conversation.summaryUpToMessageId": "a message of the same conversation; both go with their student",
  "SageInsight.sourceMessageId": "a message of the insight's own student; both go together",
  "SageInsight.sourceConversationId": "a conversation of the insight's own student; both go together",
  "Goal.sourceMessageId": "a message of the goal's own student; both go together",
  "ProgressionEvent.sourceId": "the row that earned the event, of the event's own student",
  "StudentAlert.sourceId": "the row that raised the alert, of the alert's own student",
  "Opportunity.sourceJobLeadId": "counted as leftBehind.opportunitiesFromDemoLeads; the listing is shared content and stays",
  "Application.pathwayClusterId": "a career cluster key from the catalog, not a row",
  "Connection.tokenContactId": "an EmployerContact id; employers are shared and never deleted",
  "OutboundMessage.providerId": "the SMS or email provider's message id, from outside the database",
  "OutboundMessage.employerId": "an Employer id; employers are shared and never deleted",
  "FormSubmission.formId": "a form key from the catalog, not a row",
  "ProgramDocument.certificationId": "a certification key from the catalog, not a row",
  "ProgramDocument.platformId": "a platform key from the catalog, not a row",
  "SageMemory.sourceId": "the conversation or operation the memory came from, of the memory's own subject",
  "Wager.sourceOperationId": "a Sage operation of the wager's own student; both go together",
  "Wager.sourceMessageId": "a message of the wager's own student; both go together",
  "WagerVerdict.knowledgeUpdateId": "a knowledge update of the verdict's own wager; both go together",
  "GoalResourceLink.resourceId": "a shared learning resource key, not a row the closeout deletes",
  "CareerDiscovery.conversationId": "a conversation of the discovery's own student; both go together",
  "MoodEntry.conversationId": "a conversation of the entry's own student; both go together",
  "FailedExtraction.conversationId": "a conversation of the extraction's own student; both go together",
  "FailedExtraction.sourceMessageId": "a message of the extraction's own student; both go together",
  "JobScrapeRun.backgroundJobId": "the job that ran this scrape, for the run's own class config",
  "JobListing.sourceId": "the job board's own listing id, from outside the database",
  "JobListing.scrapeBatchId": "a scrape batch label, not a row",
  "JobBrowseListing.sourceId": "the job board's own listing id, from outside the database",
  "JobBrowseListing.scrapeBatchId": "a scrape batch label, not a row",
  "StudentSavedJob.snapshotSourceId": "the job board's own listing id, copied when the job was saved",
  "StudentHiddenJob.snapshotSourceId": "the job board's own listing id, copied when the job was hidden",
  "ClassRequirement.itemId": "a requirement item key from the catalog, not a row",
  "StaffInvite.regionId": "a Region id; regions are shared and never deleted",
};

/**
 * Relations into a model the tool deletes from, whose child model it neither
 * deletes from nor guards. Empty today: every such child is guarded.
 */
const KEPT_LINKS: Readonly<Record<string, string>> = {};

const accountSteps = DELETE_STEPS.filter((step) => step.scope === "account");
const ownedColumns = new Set(accountSteps.flatMap((step) => (step.column ? [key(step.model, step.column)] : [])));
const guardedColumns = new Set(GUARDED_REFS.map((ref) => key(ref.model, ref.column)));
const classColumns = new Set(CLASS_COLUMNS.map((ref) => key(ref.model, ref.column)));
const deletedModels = new Set<string>(DELETE_STEPS.map((step) => step.model));

/** Field and relation names in a where clause that the schema does not have, followed through relations. */
function unknownNames(model: string, where: unknown, path = model): string[] {
  if (typeof where !== "object" || where === null || Array.isArray(where)) return [];
  return Object.entries(where).flatMap(([name, condition]): string[] => {
    if (name === "AND" || name === "OR" || name === "NOT") {
      return (Array.isArray(condition) ? condition : [condition]).flatMap((part) => unknownNames(model, part, path));
    }
    const field = modelNamed(model).fields.find((candidate) => candidate.name === name);
    if (!field) return [`${path}.${name}`];
    return field.kind === "object" ? unknownNames(field.type, condition, `${path}.${name}`) : [];
  });
}

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

  it("classifies every text column whose name says it may hold a person's id", () => {
    // A column that holds an account id with no foreign key is invisible to the
    // rules above. The name is the only clue the schema gives.
    const unclassified = MODELS.filter((model) => model.name !== "Student")
      .flatMap((model) => model.fields.filter((field) => field.kind === "scalar" && field.type === "String" && PERSON_ID_NAME.test(field.name))
        .map((field) => key(model.name, field.name)))
      .filter((column) => !ownedColumns.has(column) && !guardedColumns.has(column) && !classColumns.has(column) && !Object.hasOwn(NOT_PERSON_IDS, column));

    assert.deepEqual(unclassified, []);
    for (const column of Object.keys(NOT_PERSON_IDS)) {
      const [model, name] = column.split(".");
      assert.ok(modelNamed(model).fields.some((field) => field.name === name), `${column} is not in the schema`);
    }
  });

  it("deletes, guards or names with a reason every relation into a model the tool deletes from", () => {
    const unaccounted = EDGES.filter((edge) => deletedModels.has(edge.parent))
      .filter((edge) => !deletedModels.has(edge.child) && !guardedColumns.has(key(edge.child, edge.from[0])))
      .map((edge) => key(edge.child, edge.from[0]))
      .filter((column) => !Object.hasOwn(KEPT_LINKS, column));

    assert.deepEqual(unaccounted, []);
  });

  it("checks at run time every SetNull relation into a model the tool deletes from", () => {
    const expected = EDGES.filter((edge) => deletedModels.has(edge.parent) && edge.onDelete === "SetNull")
      .map((edge) => key(edge.child, edge.from.join(","))).sort();

    assert.deepEqual(SET_NULL_LINKS.map((link) => key(link.child, link.from)).sort(), expected);
    for (const link of SET_NULL_LINKS) assert.ok(modelNamed(link.child).fields.some((field) => field.name === "id"), `${link.child} needs an id`);
  });

  it("classifies every text column named like a row id that has no relation", () => {
    // A link with no foreign key is invisible to the database's delete rules,
    // so a kept row can be left naming a deleted file or goal with nothing to stop it.
    const unlinked = new Set(UNLINKED_REFS.map((link) => key(link.child, link.from)));
    const probed = new Set(ORPHAN_PROBES.map((probe) => key(probe.model, probe.column)));
    const unclassified = MODELS.flatMap((model) => {
      const foreignKeys = new Set(EDGES.filter((edge) => edge.child === model.name).flatMap((edge) => edge.from));
      return model.fields.filter((field) => field.kind === "scalar" && field.type === "String" && !field.isId && /Id$/.test(field.name) && !foreignKeys.has(field.name))
        .map((field) => key(model.name, field.name));
    }).filter((column) => ![unlinked, probed, ownedColumns, guardedColumns, classColumns].some((list) => list.has(column))
      && !Object.hasOwn(NOT_ROW_LINKS, column) && !Object.hasOwn(NOT_PERSON_IDS, column));

    assert.deepEqual(unclassified, []);
  });

  it("checks at run time each unlinked file and goal column, each into a model the tool deletes from", () => {
    assert.deepEqual(UNLINKED_REFS.map((link) => key(link.child, link.from)).sort(), [
      "Application.resumeFileId", "CertRequirement.fileId", "FormSubmission.fileId", "FormSubmission.signatureFileId",
      "PortfolioItem.fileId", "VisionBoardItem.fileId", "VisionBoardItem.goalId",
    ]);
    const foreignKeys = new Set(EDGES.map((edge) => key(edge.child, edge.from[0])));
    for (const link of UNLINKED_REFS) {
      assert.ok(deletedModels.has(link.parent), `${link.parent} is not deleted by any step`);
      assert.equal(foreignKeys.has(key(link.child, link.from)), false, `${link.child}.${link.from} has a foreign key`);
      assert.ok(modelNamed(link.child).fields.some((field) => field.name === "id"), `${link.child} needs an id`);
    }
    for (const column of Object.keys(NOT_ROW_LINKS)) {
      const [model, name] = column.split(".");
      assert.ok(modelNamed(model).fields.some((field) => field.name === name), `${column} is not in the schema`);
    }
  });

  it("probes for orphans in exactly the account and class columns that have no foreign key", () => {
    const foreignKeys = new Set(EDGES.map((edge) => key(edge.child, edge.from[0])));
    const softColumns = new Set([...ownedColumns, ...guardedColumns, ...classColumns, ...ABOUT_OTHERS.map((ref) => key(ref.model, ref.column))]);
    const expected = [...softColumns].filter((column) => !foreignKeys.has(column) && !column.endsWith(".id")).sort();

    assert.deepEqual([...new Set(ORPHAN_PROBES.map((probe) => key(probe.model, probe.column)))].sort(), expected);
    for (const probe of ORPHAN_PROBES) {
      for (const column of [probe.column, ...(probe.only ? [probe.only.column] : [])]) {
        const field = modelNamed(probe.model).fields.find((candidate) => candidate.name === column);
        assert.ok(field && field.kind === "scalar" && field.type === "String", `${probe.model}.${column}`);
      }
      assert.equal(modelNamed(probe.model).dbName, null, `${probe.model} is stored under another table name`);
    }
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

  it("filters only on fields and relations the schema has, however deep the filter goes", () => {
    const ids = ["an-id"];
    const filters = [
      ...DELETE_STEPS.map((step) => ({ model: step.model, where: step.where(ids) })),
      ...UNMARKED_ON_DEMO_CLASS.map((entry) => ({ model: entry.model, where: entry.where(ids) })),
      ...GUARDED_REFS.flatMap((ref) => (ref.survives.kind === "where" ? [{ model: ref.model, where: ref.survives.where(ids) }] : [])),
    ];

    assert.ok(filters.length >= 100);
    assert.deepEqual(filters.flatMap((filter) => unknownNames(filter.model, filter.where)), []);
    assert.deepEqual(unknownNames("Goal", { student: { noSuchColumn: null }, OR: [{ nope: 1 }] }), ["Goal.student.noSuchColumn", "Goal.nope"]);
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
