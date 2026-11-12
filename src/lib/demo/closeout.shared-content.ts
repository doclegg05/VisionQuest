/**
 * Demo closeout (readiness H10e): audit rows about shared content.
 *
 * Some routes let a demo account act on content every account shares, and log
 * that content's id as the target. The closeout keeps that content, so the
 * refusal `records_about_unmarked_people` could never clear. For the short
 * list below the closeout keeps the audit row and replaces the demo account's
 * id with CLOSED_DEMO_ACTOR, so the record of the action survives without
 * naming an account that is gone. A row about kept content that is not on
 * this list, such as the demo instructor editing a real event, still refuses.
 */
import { chunksOf, idsOf, tableOf, type Ids, type Run } from "./closeout.core";

/**
 * The actor written in place of a deleted demo account. The orphan probe
 * leaves it out (SENTINEL_ACTORS in closeout.server.ts), as no account has it.
 */
export const CLOSED_DEMO_ACTOR = "demo-closed";

/** Which demo account may have written a row: a marked student or the marked instructor. */
type DemoKind = "student" | "instructor";

export interface SharedContentRecord {
  /** The AuditLog targetType, exactly as the route writes it. */
  readonly targetType: string;
  readonly actions: readonly string[];
  readonly actor: DemoKind;
}

/**
 * Shared content a demo account may act on, with no demo gating on the route.
 * Each targetType names a row the closeout never deletes.
 */
export const SHARED_CONTENT_RECORDS: readonly SharedContentRecord[] = [
  // A CareerEvent: src/app/api/events/[id]/register/route.ts (POST and DELETE).
  { actor: "student", targetType: "event", actions: ["event.registered", "event.unregistered"] },
  // An Opportunity: src/app/api/applications/route.ts.
  { actor: "student", targetType: "opportunity", actions: ["application.updated"] },
  // A JobBrowseListing: src/app/api/jobs/save/route.ts. A class JobListing is not shared, so it is not here.
  { actor: "student", targetType: "JobBrowseListing", actions: ["job.save"] },
  // Not listed on purpose: `teacher.form.export` (form_template). It is a bulk
  // export of real students' intake answers, admins only, and READ_DENY refuses
  // the demo instructor. A row for it means a demo account once had admin rights,
  // which is a disclosure that must stop the closeout, so it refuses.
];
// Kept rows keep their summary text. A `job.save` summary names the demo
// account's seeded display name from bootstrap.ts, which visitors cannot change.

/** How each kind of demo account is marked, as reset.ts and bootstrap.ts create it. */
const MARK_OF: Readonly<Record<DemoKind, { readonly role: string; readonly demoAccount: string }>> = {
  student: { role: "student", demoAccount: "student" },
  instructor: { role: "teacher", demoAccount: "instructor" },
};

async function plannedOfKind(run: Run, kind: DemoKind): Promise<string[]> {
  const found: string[] = [];
  for (const chunk of chunksOf(run.plan.accountIds, run.chunk)) {
    const rows = await tableOf(run.tx, "Student").findMany({ where: { id: { in: chunk }, ...MARK_OF[kind] }, select: { id: true } });
    found.push(...idsOf(rows, "id"));
  }
  return found;
}

async function rowsOf(run: Run, record: SharedContentRecord, actors: Ids): Promise<string[]> {
  const found: string[] = [];
  for (const chunk of chunksOf(actors, run.chunk)) {
    const rows = await tableOf(run.tx, "AuditLog").findMany({
      where: { actorId: { in: chunk }, targetType: record.targetType, action: { in: [...record.actions] }, targetId: { not: null } },
      select: { id: true },
    });
    found.push(...idsOf(rows, "id"));
  }
  return found;
}

/** The ids of the audit rows the closeout keeps, with the actor replaced. */
export async function sharedContentAuditIds(run: Run): Promise<ReadonlySet<string>> {
  const actors: Record<DemoKind, string[]> = { student: await plannedOfKind(run, "student"), instructor: await plannedOfKind(run, "instructor") };
  const found = new Set<string>();
  for (const record of SHARED_CONTENT_RECORDS) {
    if (actors[record.actor].length === 0) continue;
    (await rowsOf(run, record, actors[record.actor])).forEach((id) => found.add(id));
  }
  return found;
}

/** Replaces the demo account on these rows with CLOSED_DEMO_ACTOR. Runs inside the apply's transaction, before any delete. */
export async function closeSharedContentRows(run: Run, ids: ReadonlySet<string>): Promise<number> {
  let changed = 0;
  for (const chunk of chunksOf([...ids], run.chunk)) {
    changed += (await tableOf(run.tx, "AuditLog").updateMany({ where: { id: { in: chunk } }, data: { actorId: CLOSED_DEMO_ACTOR } })).count;
  }
  return changed;
}
