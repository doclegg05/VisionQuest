/**
 * Demo closeout (readiness H10): the checks that look past the plan's own rows.
 *
 *   - Recent activity: a demo account that was created or used in the last 30
 *     minutes means the demo may still be served, and the server would make the
 *     demo instructor, class and starters again beside real students.
 *   - Records about other people: an audit row, a Sage operation or a message a
 *     demo account is on, but that is about someone or something the plan
 *     keeps. Deleting it would remove the proof of what a demo account did to
 *     real data.
 *   - SetNull links: a kept row whose link to a deleted row the database would
 *     quietly blank. No count changes, so only this check can see it.
 *   - Unlinked ids: a kept row that names a deleted upload or goal in a column
 *     with no foreign key. Nothing changes at all, so again only this check.
 *
 * Each returns a count. closeout.ts turns a count above 0 into a refusal.
 */
import { Prisma } from "@prisma/client";
import { sharedContentAuditIds } from "./closeout.shared-content";
import { UNMARKED, chunksOf, idsFor, idsOf, plannedValues, tableOf, valuesWhere, type DeleteStep, type Run } from "./closeout.core";

/** How far back a demo account's activity still counts as the demo being live. */
export const RECENT_MINUTES = 30;

/** Rows that show a planned account was created or used in the last 30 minutes, by the server's clock. */
export async function recentActivity(run: Run): Promise<number> {
  const since = { gte: new Date(run.now.getTime() - RECENT_MINUTES * 60_000) };
  let total = 0;
  for (const chunk of chunksOf(run.plan.accountIds, run.chunk)) {
    const ids = { in: chunk };
    total += await tableOf(run.tx, "Student").count({ where: { id: ids, createdAt: since } });
    total += await tableOf(run.tx, "Message").count({ where: { studentId: ids, createdAt: since } });
    total += await tableOf(run.tx, "Conversation").count({ where: { studentId: ids, OR: [{ createdAt: since }, { updatedAt: since }] } });
    total += await tableOf(run.tx, "AuditLog").count({ where: { actorId: ids, createdAt: since } });
  }
  return total;
}

/** The columns, all deleted by a step, whose rows can be about someone the plan keeps. */
export const ABOUT_OTHERS = [
  { model: "AuditLog", column: "actorId" },
  { model: "SageOperation", column: "actorId" },
  { model: "OutboundMessage", column: "toId" },
] as const;

function hasIdColumn(model: string): boolean {
  return Prisma.dmmf.datamodel.models.some((entry) => entry.name === model && entry.fields.some((field) => field.name === "id" && field.type === "String"));
}

/** Which of these ids are the id of a row some step deletes. Only the candidates are looked up. */
async function deletedAmong(run: Run, steps: readonly DeleteStep[], candidates: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const step of steps.filter((entry) => hasIdColumn(entry.model))) {
    for (const chunk of chunksOf(idsFor(run, step.scope), run.chunk)) {
      for (const wanted of chunksOf(candidates, run.chunk)) {
        const rows = await tableOf(run.tx, step.model).findMany({ where: { AND: [step.where(chunk), { id: { in: wanted } }] }, select: { id: true } });
        idsOf(rows, "id").forEach((id) => found.add(id));
      }
    }
  }
  return found;
}

/**
 * Audit rows a planned account wrote whose target the plan keeps. The target
 * is often a row id, not a person: an appointment, a certification, a goal.
 * So every target id must be a planned account, a planned class or a row a
 * step deletes. Anything else is a record of what a demo account did to data
 * that stays, and deleting it would erase that record. The exception is a row
 * about shared content (closeout.shared-content.ts): the apply keeps it.
 */
async function auditRowsAboutKeptTargets(run: Run, steps: readonly DeleteStep[], planned: ReadonlySet<string>): Promise<number> {
  const kept = await sharedContentAuditIds(run);
  const targets: string[] = [];
  for (const chunk of chunksOf(run.plan.accountIds, run.chunk)) {
    const rows = await tableOf(run.tx, "AuditLog").findMany({ where: { actorId: { in: chunk }, targetId: { not: null } }, select: { id: true, targetId: true } });
    const aboutOthers = rows.filter((row) => typeof row.id !== "string" || !kept.has(row.id));
    targets.push(...idsOf(aboutOthers, "targetId").filter((id) => !planned.has(id)));
  }
  if (targets.length === 0) return 0;
  const deleted = await deletedAmong(run, steps, [...new Set(targets)]);
  return targets.filter((id) => !deleted.has(id)).length;
}

/** Rows a planned account is on that are about a kept account, class or row. */
export async function recordsAboutOthers(run: Run, steps: readonly DeleteStep[]): Promise<number> {
  const planned = new Set([...run.plan.accountIds, ...run.plan.classIds]);
  const outside = (values: readonly string[]): number => values.filter((value) => !planned.has(value)).length;
  let total = await auditRowsAboutKeptTargets(run, steps, planned);
  for (const chunk of chunksOf(run.plan.accountIds, run.chunk)) {
    const operations = await tableOf(run.tx, "SageOperation").findMany({
      where: { actorId: { in: chunk }, targetStudentId: { not: null } },
      select: { targetStudentId: true },
    });
    total += outside(idsOf(operations, "targetStudentId"));
    total += await tableOf(run.tx, "OutboundMessage").count({ where: { toId: { in: chunk }, connection: { student: UNMARKED } } });
  }
  return total;
}

/** Audit rows the plan deletes that a person outside the plan wrote, such as a real teacher opening a demo student. */
export async function deletedAuditRowsWithUnmarkedActor(run: Run, auditSteps: readonly DeleteStep[]): Promise<number> {
  const planned = new Set(run.plan.accountIds);
  const actorOf = new Map<string, unknown>();
  for (const step of auditSteps) {
    for (const chunk of chunksOf(idsFor(run, step.scope), run.chunk)) {
      const rows = await tableOf(run.tx, "AuditLog").findMany({ where: step.where(chunk), select: { id: true, actorId: true } });
      for (const row of rows) actorOf.set(String(row.id), row.actorId);
    }
  }
  return [...actorOf.values()].filter((actor) => typeof actor === "string" && !planned.has(actor)).length;
}

/** A foreign key whose delete rule is SetNull: the child, its column, the parent and the parent's column. */
export interface SetNullLink {
  readonly child: Prisma.ModelName;
  readonly from: string;
  readonly parent: Prisma.ModelName;
  readonly to: string;
}

function isModelName(name: string): name is Prisma.ModelName {
  return Object.values<string>(Prisma.ModelName).includes(name);
}

/** Prisma's rule when none is written: an optional relation is set to null. */
function setsNull(field: Prisma.DMMF.Field): boolean {
  return field.relationOnDelete === "SetNull" || (field.relationOnDelete === undefined && !field.isRequired);
}

/** Every single-column SetNull foreign key into one of these models, read from the generated client. */
export function setNullLinksInto(parents: ReadonlySet<string>): SetNullLink[] {
  return Prisma.dmmf.datamodel.models.flatMap((model) =>
    model.fields.flatMap((field): SetNullLink[] => {
      const from = field.relationFromFields ?? [];
      const to = field.relationToFields ?? [];
      if (field.kind !== "object" || from.length !== 1 || to.length !== 1 || !setsNull(field)) return [];
      if (!parents.has(field.type) || !isModelName(field.type) || !isModelName(model.name)) return [];
      return [{ child: model.name, from: from[0], parent: field.type, to: to[0] }];
    }));
}

/**
 * Kept rows that point at a row the plan deletes, through one of these links.
 * Through a SetNull foreign key the database would blank each one; through a
 * column with no foreign key it would be left naming a row that is gone.
 */
export async function keptRowsLinkedToDeleted(run: Run, steps: readonly DeleteStep[], links: readonly SetNullLink[]): Promise<number> {
  const stepsOf = (model: string) => steps.filter((step) => step.model === model);
  let total = 0;
  for (const link of links) {
    const parents = await plannedValues(run, stepsOf(link.parent), link.to);
    if (parents.size === 0) continue;
    const pointing = await valuesWhere(run, link.child, link.from, "id", [...parents]);
    if (pointing.length === 0) continue;
    const deleted = await plannedValues(run, stepsOf(link.child), "id");
    total += pointing.filter((id) => !deleted.has(id)).length;
  }
  return total;
}
