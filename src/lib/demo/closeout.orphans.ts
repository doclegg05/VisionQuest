/**
 * Demo closeout (readiness H10): what the tool leaves behind, as counts.
 *
 *   - Orphans: rows whose account or class column has no foreign key and names
 *     an account or class that does not exist. Some are expected: Sage keeps
 *     operations about students who were offboarded. So the apply counts every
 *     column again after its deletes, in its own transaction, and refuses if
 *     any column rose (`orphansThatRose` in closeout.ts).
 *   - Text that names the plan: program settings that hold a demo class id,
 *     staff notices that mention a demo account by name, and listings mirrored
 *     from a demo class's job lead.
 *   - Storage folders: uploads are kept under a folder named for the account.
 *
 * Counts only. No value found here is returned, printed or logged.
 */
import { idsOf, tableOf, valuesWhere, type Run } from "./closeout.core";
import { countOrphans, noticesNaming, type OrphanProbe } from "./closeout.server";
import { sharedContentAuditIds } from "./closeout.shared-content";

export type { OrphanProbe } from "./closeout.server";

const toAccount = (model: OrphanProbe["model"], column: string, only?: OrphanProbe["only"]): OrphanProbe => ({ model, column, parent: "Student", only });
const toClass = (model: OrphanProbe["model"], column: string, only?: OrphanProbe["only"]): OrphanProbe => ({ model, column, parent: "SpokesClass", only });

/**
 * Every account or class column the closeout knows that has no foreign key.
 * A column that holds ids of several kinds is probed once per kind, through
 * the column that says which kind the row holds.
 */
export const ORPHAN_PROBES: readonly OrphanProbe[] = [
  toAccount("AuditLog", "actorId"),
  toAccount("AuditLog", "targetId", { column: "targetType", values: ["student"] }),
  toClass("AuditLog", "targetId", { column: "targetType", values: ["class"] }),
  toAccount("SageOperation", "actorId", { column: "actorType", values: ["student", "teacher", "admin", "coordinator"] }),
  toAccount("SageOperation", "targetStudentId"),
  toAccount("OutboundMessage", "toId", { column: "toKind", values: ["student", "staff"] }),
  toAccount("FormAssignment", "targetId", { column: "scope", values: ["student"] }),
  toClass("FormAssignment", "targetId", { column: "scope", values: ["class"] }),
  toAccount("SageMemory", "subjectId", { column: "subjectType", values: ["student", "teacher"] }),
  toClass("SageMemory", "subjectId", { column: "subjectType", values: ["class"] }),
  toClass("GrantKpiSnapshot", "classId"),
  toAccount("SageInsight", "editedBy"),
  toAccount("SageInsight", "dismissedBy"),
  toAccount("SagePanel", "dismissedBy"),
  toAccount("OrientationProgress", "verifiedBy"),
  toAccount("Certification", "verifiedBy"),
  toAccount("CertRequirement", "verifiedBy"),
  toAccount("StudentAlert", "snoozedBy"),
  toAccount("Application", "verifiedBy"),
  toAccount("ConnectionEvent", "actorId"),
  toAccount("FormSubmission", "reviewedBy"),
  toAccount("ConsentRecord", "recordedBy"),
  toAccount("WagerVerdict", "resolvedBy"),
  toAccount("FailedExtraction", "resolvedBy"),
  toAccount("RegionInstructor", "assignedById"),
  toAccount("JobScrapeRun", "requestedById"),
  toAccount("LmsLink", "createdBy"),
  toAccount("ProgramDocument", "uploadedBy"),
  toAccount("SageSnippet", "authorId"),
  toAccount("SystemConfig", "updatedBy"),
  toAccount("StaffInvite", "invitedById"),
  toAccount("StaffInvite", "acceptedById"),
];

/** Orphan rows by `Model.column`, each column's kinds added together. */
export async function orphanCounts(run: Run): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const probe of ORPHAN_PROBES) {
    const name = `${probe.model}.${probe.column}`;
    counts[name] = (counts[name] ?? 0) + (await countOrphans(run.tx, probe));
  }
  return counts;
}

export interface LeftBehind {
  /** Rows naming an account or class that does not exist, by `Model.column`. None may be higher after an apply. */
  readonly orphans: Readonly<Record<string, number>>;
  /** Program settings whose value holds a demo class id, such as a pilot class list. */
  readonly systemConfigNamingDemoClass: number;
  /** Notices to staff with no demo mark whose title or text holds a demo account's display name. */
  readonly staffNotificationsAboutDemoStudents: number;
  /** Opportunity listings mirrored from a job lead the closeout deletes. */
  readonly opportunitiesFromDemoLeads: number;
  /** Storage folders that hold the planned accounts' uploads. The tool removes none of them. */
  readonly storageFoldersOfDemoAccounts: number;
  /** Audit rows a demo account wrote about shared content. They stay, with the actor replaced (closeout.shared-content.ts). */
  readonly auditRowsKeptAboutSharedContent: number;
}

async function settingsNamingClasses(run: Run): Promise<number> {
  const found = new Set<string>();
  for (const classId of run.plan.classIds) {
    const rows = await tableOf(run.tx, "SystemConfig").findMany({ where: { value: { contains: classId } }, select: { id: true } });
    idsOf(rows, "id").forEach((id) => found.add(id));
  }
  return found.size;
}

async function mirroredOpportunities(run: Run): Promise<number> {
  const leads = await valuesWhere(run, "JobLead", "classId", "id", run.plan.classIds);
  return leads.length === 0 ? 0 : tableOf(run.tx, "Opportunity").count({ where: { sourceJobLeadId: { in: leads } } });
}

/** An upload's folder is the first part of its storage key: the account id (generateStorageKey in storage.ts). */
async function storageFolders(run: Run): Promise<number> {
  const keys = await valuesWhere(run, "FileUpload", "studentId", "storageKey", run.plan.accountIds);
  return new Set(keys.map((key) => key.split("/")[0])).size;
}

export async function leftBehind(run: Run): Promise<LeftBehind> {
  return {
    orphans: await orphanCounts(run),
    systemConfigNamingDemoClass: await settingsNamingClasses(run),
    staffNotificationsAboutDemoStudents: await noticesNaming(run.tx, run.plan.accountIds, run.chunk),
    opportunitiesFromDemoLeads: await mirroredOpportunities(run),
    storageFoldersOfDemoAccounts: await storageFolders(run),
    auditRowsKeptAboutSharedContent: (await sharedContentAuditIds(run)).size,
  };
}
