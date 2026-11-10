/**
 * Demo closeout (readiness H10): delete the cohort demo's rows before real
 * students use the same database. Owner-only and offline: scripts/demo-closeout.ts
 * is the one caller, and nothing here is reachable over HTTP.
 *
 * What it deletes is decided by a selection rule (the marked demo accounts and
 * the demo class), kept apart from the deletion so a second rule could be added
 * without touching it. The deletion then follows three rules of its own:
 *
 *   1. Every removal is an explicit step in DELETE_STEPS, children before
 *      parents. No removal is left to a database cascade. Each step's comment
 *      cites the schema line whose rule it stands in for.
 *   2. Before an account or a class is deleted, nothing may still name it.
 *      GUARDED_REFS and CLASS_COLUMNS list every column that could.
 *   3. Afterwards every table in the schema must have lost exactly the rows
 *      the preview counted. A cascade that took a row no step listed shows up
 *      as a difference, and the transaction is rolled back.
 *
 * Table and column names are plain strings here, so the compiler cannot check
 * them. closeout.inventory.test.ts checks every one against the schema, and
 * fails when the schema gains a link to Student or SpokesClass that these
 * lists do not mention.
 *
 * Nothing in this file prints, logs or returns a name, a login, an email or an
 * id. Counts and fixed sentences only.
 */
import { Prisma } from "@prisma/client";
import { DEMO_CLASS_CODE, DEMO_INSTRUCTOR_LOGIN, isCohortDemoEnabled, isRealStudentDataDeclared } from "./config";
import {
  UNMARKED, chunksOf, countIn, idsOf, inList, tableOf, valuesWhere,
  type CloseoutClient, type CloseoutPlan, type CloseoutTx, type DemoEnv, type Ids, type Run, type Where,
} from "./closeout.core";
import type { LocalSchema } from "./closeout.local";
import { refusal, type Refusal, type RefusalCode } from "./closeout.report";
import { readServerFacts, refuseFilteredReads, tryCreateLock, type CloseoutTarget, type ServerFacts } from "./closeout.server";

export { tableOf, type CloseoutClient, type CloseoutPlan, type CloseoutTx, type Where } from "./closeout.core";
export { REFUSALS, type Refusal, type RefusalCode } from "./closeout.report";
export type { CloseoutTarget } from "./closeout.server";

/** The accounts and classes a rule picks. The queued jobs are worked out from the accounts. */
export type Selection = Pick<CloseoutPlan, "accountIds" | "classIds">;

export type SelectionRule = (tx: CloseoutTx) => Promise<Selection>;

/** The demo instructor exactly as reset.ts identifies it: this login, this role, this marker. */
const DEMO_INSTRUCTOR = { studentId: DEMO_INSTRUCTOR_LOGIN, role: "teacher", demoAccount: "instructor" } as const;

/**
 * The one rule: every Student row with a demo marker, and the class that holds
 * the demo class code and was created by the marked demo instructor. A class
 * that merely has the demo code is not the demo class (see `ensureClass` in
 * bootstrap.ts); it is reported as a refusal and left alone.
 */
export const markedDemoAccountsRule: SelectionRule = async (tx) => {
  const accounts = await tableOf(tx, "Student").findMany({ where: { demoAccount: { not: null } }, select: { id: true } });
  const classes = await tableOf(tx, "SpokesClass").findMany({
    where: { code: DEMO_CLASS_CODE, createdBy: DEMO_INSTRUCTOR },
    select: { id: true },
  });
  return { accountIds: idsOf(accounts, "id"), classIds: idsOf(classes, "id") };
};

export interface DeleteStep {
  readonly model: Prisma.ModelName;
  /** Which ids the step is given: the plan's accounts or its classes. */
  readonly scope: "account" | "class";
  /** The column that holds the id, or null for a row reached through its parent. */
  readonly column: string | null;
  readonly where: (ids: Ids) => Where;
}

const own = (model: Prisma.ModelName, column: string): DeleteStep => ({ model, scope: "account", column, where: inList(column) });
const ofClass = (model: Prisma.ModelName, column: string): DeleteStep => ({ model, scope: "class", column, where: inList(column) });
const under = (model: Prisma.ModelName, scope: DeleteStep["scope"], where: (ids: Ids) => Where): DeleteStep => ({
  model, scope, column: null, where,
});

/**
 * Rows that belong to an account, children first. "L" numbers are lines of
 * prisma/schema.prisma. Where the line says Cascade the database would have
 * removed the row with its parent; it is removed here first so that rule 3 in
 * the header can tell a planned removal from an unplanned one.
 */
const ACCOUNT_STEPS: readonly DeleteStep[] = [
  // Connection and what hangs off it. Connection.proposedById is Restrict
  // (L1270), so a connection must be gone before the account that proposed it.
  under("OutboundMessage", "account", (ids) => ({ connection: { studentId: { in: ids } } })), // L1362 SetNull would leave the message behind
  own("OutboundMessage", "toId"), // no foreign key: the student or staff member the message was to
  under("ConnectionEvent", "account", (ids) => ({ connection: { studentId: { in: ids } } })), // L1315 Cascade
  own("Connection", "studentId"), // L1248 Cascade
  under("WagerVerdict", "account", (ids) => ({ wager: { studentId: { in: ids } } })), // L1874 Cascade
  own("Wager", "studentId"), // L1850 Cascade
  under("CampaignStep", "account", (ids) => ({ campaign: { studentId: { in: ids } } })), // L1911 Cascade
  own("CareerCampaign", "studentId"), // L1897 Cascade
  under("CertRequirement", "account", (ids) => ({ certification: { studentId: { in: ids } } })), // L544 Cascade
  own("Certification", "studentId"), // L526 Cascade
  under("SpokesChecklistProgress", "account", (ids) => ({ record: { studentId: { in: ids } } })), // L452 Cascade
  under("SpokesModuleProgress", "account", (ids) => ({ record: { studentId: { in: ids } } })), // L487 Cascade
  under("SpokesEmploymentFollowUp", "account", (ids) => ({ record: { studentId: { in: ids } } })), // L505 Cascade
  own("SpokesRecord", "studentId"), // L414 is SetNull: the schema would keep this record with no student
  own("GoalResourceLink", "studentId"), // L1995 Cascade (and L1994 from Goal)
  own("Goal", "studentId"), // L266 Cascade
  own("Message", "studentId"), // L184 Cascade (and L183 from Conversation)
  own("Conversation", "studentId"), // L166 Cascade
  own("StudentTask", "studentId"), // L864 Cascade
  own("Appointment", "studentId"), // L813 Cascade
  own("NotificationPreference", "studentId"), // L148 Cascade
  own("SageInsight", "studentId"), // L215 Cascade
  own("SagePanel", "studentId"), // L243 Cascade
  own("Progression", "studentId"), // L284 Cascade
  own("ProgressionEvent", "studentId"), // L300 Cascade
  own("OrientationProgress", "studentId"), // L352 Cascade
  own("PortfolioItem", "studentId"), // L579 Cascade
  own("ResumeData", "studentId"), // L591 Cascade
  own("ResumeVersion", "studentId"), // L616 Cascade
  own("CoverLetter", "studentId"), // L639 Cascade
  own("StudentWorkProfile", "studentId"), // L683 Cascade
  own("FileUpload", "studentId"), // L716 Cascade. The stored file itself is not removed: see DEPLOY.md
  own("StudentClassEnrollment", "studentId"), // L779 Cascade
  own("CaseNote", "studentId"), // L883 Cascade
  own("StudentAlert", "studentId"), // L909 Cascade
  own("Application", "studentId"), // L1164 Cascade
  own("EventRegistration", "studentId"), // L1406 Cascade
  own("PublicCredentialPage", "studentId"), // L1424 Cascade
  own("PasswordResetToken", "studentId"), // L1437 Cascade
  own("SecurityQuestionAnswer", "studentId"), // L1451 Cascade
  own("Notification", "studentId"), // L1468 Cascade
  own("FormSubmission", "studentId"), // L1530 Cascade
  own("FormResponse", "studentId"), // L1597 Cascade
  own("ConsentRecord", "studentId"), // L1796 Cascade
  own("VisionBoardItem", "studentId"), // L1971 Cascade
  own("CareerDiscovery", "studentId"), // L2035 Cascade
  own("CareerAssessmentSnapshot", "studentId"), // L2070 Cascade
  own("MoodEntry", "studentId"), // L2085 Cascade
  own("CoachingArc", "studentId"), // L2143 Cascade
  own("StudentSavedJob", "studentId"), // L2326 Cascade
  own("StudentHiddenJob", "studentId"), // L2358 Cascade
  own("LlmCallLog", "studentId"), // L2385 Cascade
  own("FailedExtraction", "studentId"), // L2620 Cascade
  // The account's own staff rows.
  own("AdvisorAvailability", "advisorId"), // L844 Cascade
  own("SpokesClassInstructor", "instructorId"), // L760 Cascade
  own("RegionCoordinator", "coordinatorId"), // L2527 Cascade
  own("RegionInstructor", "instructorId"), // L2541 Cascade
  // Rows that name the account in a column with no foreign key. The schema
  // would leave every one of these behind.
  own("FormAssignment", "targetId"),
  under("SageMemoryEdge", "account", (ids) => ({ from: { subjectId: { in: ids } } })), // Cascade from SageMemory
  under("SageMemoryEdge", "account", (ids) => ({ to: { subjectId: { in: ids } } })),
  own("SageMemory", "subjectId"),
  own("SageOperation", "actorId"),
  own("SageOperation", "targetStudentId"),
  own("AuditLog", "actorId"),
  own("AuditLog", "targetId"),
];

/** Rows that belong to a demo class, children first. */
const CLASS_STEPS: readonly DeleteStep[] = [
  under("JobScrapeSourceResult", "class", (ids) => ({ scrapeRun: { classConfig: { classId: { in: ids } } } })), // L2211 Cascade
  under("JobScrapeRun", "class", (ids) => ({ classConfig: { classId: { in: ids } } })), // L2189 Cascade
  under("JobListing", "class", (ids) => ({ classConfig: { classId: { in: ids } } })), // L2240 Cascade
  ofClass("JobClassConfig", "classId"), // L2163 Cascade
  ofClass("ClassRequirement", "classId"), // L2428 Cascade
  ofClass("JobLead", "classId"), // L1112 Cascade: a lead scoped to the demo class goes with it
  ofClass("GrantKpiSnapshot", "classId"), // no foreign key
  ofClass("FormAssignment", "targetId"), // no foreign key
  under("SageMemoryEdge", "class", (ids) => ({ from: { subjectId: { in: ids } } })),
  under("SageMemoryEdge", "class", (ids) => ({ to: { subjectId: { in: ids } } })),
  ofClass("SageMemory", "subjectId"), // no foreign key
  ofClass("AuditLog", "targetId"), // no foreign key
];

const CLASS_ROOT: DeleteStep = ofClass("SpokesClass", "id");
/** The marker is repeated here so this statement can never remove an unmarked account. */
const ACCOUNT_ROOT: DeleteStep = {
  model: "Student", scope: "account", column: "id", where: (ids) => ({ id: { in: ids }, demoAccount: { not: null } }),
};

/** Every removal, in the order it runs. The demo class goes just before the accounts. */
export const DELETE_STEPS: readonly DeleteStep[] = [...ACCOUNT_STEPS, ...CLASS_STEPS, CLASS_ROOT, ACCOUNT_ROOT];

/** Which rows that name an account are NOT deleted by the plan, and so must not exist. */
export type Survives =
  | { readonly kind: "where"; readonly where: (classIds: Ids) => Where }
  /** The row is deleted only when this column holds a planned account or class. */
  | { readonly kind: "ownerKey"; readonly key: string };

export interface GuardedRef {
  readonly model: Prisma.ModelName;
  readonly column: string;
  readonly survives: Survives;
}

const guard = (model: Prisma.ModelName, column: string, survives: Survives): GuardedRef => ({ model, column, survives });
const ofUnmarkedStudent: Survives = { kind: "where", where: () => ({ student: UNMARKED }) };
const anyRow: Survives = { kind: "where", where: () => ({}) };
const through = (path: Where): Survives => ({ kind: "where", where: () => path });
/** SQL's NOT IN never matches NULL, and an empty list needs no condition at all. */
const outside = (column: string, nullable: boolean): Survives => ({
  kind: "where",
  where: (classIds) => {
    if (classIds.length === 0) return {};
    const elsewhere = { [column]: { notIn: classIds } };
    return nullable ? { OR: [{ [column]: null }, elsewhere] } : elsewhere;
  },
});

/**
 * Columns that name an account on a row the plan keeps: a teacher who wrote a
 * note, a creator of shared content, a reviewer. The tool refuses while a
 * marked account is named on a row that would survive, because the schema
 * would then either delete that row with the account (Cascade), block the
 * delete (Restrict) or blank the column (SetNull), and each of those changes a
 * row that is not demo data. The demo instructor's policy
 * (instructor-policy.ts) keeps it to its own class, so the expected count is 0.
 */
export const GUARDED_REFS: readonly GuardedRef[] = [
  guard("Goal", "confirmedBy", ofUnmarkedStudent), // L267, no rule given: SetNull
  guard("Appointment", "advisorId", ofUnmarkedStudent), // L814 Cascade
  guard("StudentTask", "createdById", ofUnmarkedStudent), // L865 Cascade
  guard("CaseNote", "authorId", ofUnmarkedStudent), // L884 Cascade
  guard("Connection", "proposedById", ofUnmarkedStudent), // L1270 Restrict
  guard("Connection", "sentById", ofUnmarkedStudent), // L1271 SetNull
  guard("FormResponse", "reviewedById", ofUnmarkedStudent), // L1598 SetNull
  guard("GoalResourceLink", "assignedById", ofUnmarkedStudent), // L1996 SetNull
  guard("FormAssignment", "assignedById", { kind: "ownerKey", key: "targetId" }), // L1576 SetNull
  guard("SpokesClass", "createdById", outside("id", false)), // L739 SetNull
  guard("JobLead", "createdById", outside("classId", true)), // L1113 SetNull
  guard("Opportunity", "createdById", anyRow), // L945 SetNull
  guard("Employer", "relationshipOwnerId", anyRow), // L998 SetNull
  guard("CareerEvent", "createdById", anyRow), // L1390 SetNull
  guard("FormTemplate", "createdById", anyRow), // L1557 SetNull
  guard("Pathway", "createdBy", anyRow), // L2409 SetNull
  // No foreign key below this line: the schema would leave the id in place.
  guard("SageInsight", "editedBy", ofUnmarkedStudent),
  guard("SageInsight", "dismissedBy", ofUnmarkedStudent),
  guard("SagePanel", "dismissedBy", ofUnmarkedStudent),
  guard("OrientationProgress", "verifiedBy", ofUnmarkedStudent),
  guard("Certification", "verifiedBy", ofUnmarkedStudent),
  guard("CertRequirement", "verifiedBy", through({ certification: { student: UNMARKED } })),
  guard("StudentAlert", "snoozedBy", ofUnmarkedStudent),
  guard("Application", "verifiedBy", ofUnmarkedStudent),
  guard("ConnectionEvent", "actorId", through({ connection: { student: UNMARKED } })),
  guard("FormSubmission", "reviewedBy", ofUnmarkedStudent),
  guard("ConsentRecord", "recordedBy", ofUnmarkedStudent),
  guard("WagerVerdict", "resolvedBy", through({ wager: { student: UNMARKED } })),
  guard("FailedExtraction", "resolvedBy", ofUnmarkedStudent),
  guard("RegionInstructor", "assignedById", through({ instructor: UNMARKED })),
  guard("JobScrapeRun", "requestedById", {
    kind: "where", where: (classIds) => (classIds.length === 0 ? {} : { classConfig: { classId: { notIn: classIds } } }),
  }),
  guard("LmsLink", "createdBy", anyRow),
  guard("ProgramDocument", "uploadedBy", anyRow),
  guard("SageSnippet", "authorId", anyRow),
  guard("SystemConfig", "updatedBy", anyRow),
  guard("StaffInvite", "invitedById", anyRow),
  guard("StaffInvite", "acceptedById", anyRow),
];

export interface ClassColumn {
  readonly model: Prisma.ModelName;
  readonly column: string;
}

/** Every column that can hold a class id. None may still hold a demo class when it is deleted. */
export const CLASS_COLUMNS: readonly ClassColumn[] = [
  { model: "SpokesClassInstructor", column: "classId" }, // L759 Cascade
  { model: "StudentClassEnrollment", column: "classId" }, // L778 Cascade
  { model: "JobLead", column: "classId" }, // L1112 Cascade
  { model: "Connection", column: "classId" }, // L1275 SetNull
  { model: "JobClassConfig", column: "classId" }, // L2163 Cascade
  { model: "ClassRequirement", column: "classId" }, // L2428 Cascade
  { model: "GrantKpiSnapshot", column: "classId" },
  { model: "FormAssignment", column: "targetId" },
  { model: "SageMemory", column: "subjectId" },
  { model: "AuditLog", column: "targetId" },
];

/**
 * Models with a relation to Student whose rows stay. Each is shared program
 * content that an account can only be the creator of. The tool deletes none of
 * them for that reason and refuses if a marked account created one
 * (GUARDED_REFS). Rows a demo student merely pointed at, such as an event it
 * registered for, are untouched.
 */
export const KEPT_ON_PURPOSE: Readonly<Partial<Record<Prisma.ModelName, string>>> = {
  SpokesClass: "Only the demo class is deleted. Any other class is a real class, whoever created it.",
  JobLead: "Only a lead scoped to the demo class is deleted. Any other lead is shared employer content.",
  Opportunity: "Shared opportunity listing. A demo student's application is deleted, the listing stays.",
  Employer: "Shared employer record. A demo student's connection is deleted, the employer stays.",
  CareerEvent: "Shared event. A demo student's registration is deleted, the event stays.",
  FormTemplate: "Shared form template. A demo student's response and assignment are deleted, the template stays.",
  Pathway: "Shared pathway. A demo student's goals are deleted, the pathway stays.",
};

/** Rows of unmarked accounts that hang off a demo class and would go, or change, with it. */
export const UNMARKED_ON_DEMO_CLASS: ReadonlyArray<{ model: Prisma.ModelName; where: (classIds: Ids) => Where }> = [
  { model: "SpokesClassInstructor", where: (ids) => ({ classId: { in: ids }, instructor: UNMARKED }) },
  {
    model: "ResumeVersion", // L617 and L618 Cascade
    where: (ids) => ({ student: UNMARKED, OR: [{ jobListing: { classConfig: { classId: { in: ids } } } }, { jobLead: { classId: { in: ids } } }] }),
  },
  {
    model: "CoverLetter", // L640 and L641 Cascade
    where: (ids) => ({ student: UNMARKED, OR: [{ jobListing: { classConfig: { classId: { in: ids } } } }, { jobLead: { classId: { in: ids } } }] }),
  },
  { model: "StudentSavedJob", where: (ids) => ({ student: UNMARKED, jobListing: { classConfig: { classId: { in: ids } } } }) }, // L2327 SetNull
  { model: "Connection", where: (ids) => ({ student: UNMARKED, OR: [{ classId: { in: ids } }, { jobLead: { classId: { in: ids } } }] }) }, // L1260 Restrict, L1275 SetNull
];

export interface CloseoutPreview {
  readonly demoModeOn: boolean;
  readonly realStudentDataDeclared: boolean;
  readonly marked: { readonly students: number; readonly instructors: number; readonly demoClasses: number };
  /** People and pages the tool does not touch. It only counts them. */
  readonly unmarked: {
    readonly students: number;
    readonly staffByRole: { readonly teacher: number; readonly admin: number; readonly coordinator: number; readonly other: number };
    readonly enrolledInDemoClass: number;
    readonly publicCredentialPages: number;
    readonly publicCredentialPagesSwitchedOn: number;
  };
  /** Rows that would go, by model. Every model a step deletes from is listed, zero included. */
  readonly rowsToDelete: Readonly<Record<string, number>>;
  /** Uploads whose database row goes while the stored file stays in storage. */
  readonly uploadedFilesLeftInStorage: number;
}

interface OutcomeBase {
  /** Which database this was, as the server reported it. */
  readonly target: CloseoutTarget;
  readonly refusals: readonly Refusal[];
}

/** An apply's result: the rows deleted by model, and what is left. */
export interface AppliedCounts {
  readonly deleted: Readonly<Record<string, number>>;
  /** Counted inside the transaction, after the deletes and before the commit. */
  readonly remaining: { readonly markedAccounts: number; readonly rowsPointingAtDeleted: number };
}

export type CloseoutOutcome =
  /** Refused before any table was read, so there are no counts to show. */
  | (OutcomeBase & { readonly kind: "unreadable" })
  | (OutcomeBase & { readonly kind: "preview"; readonly preview: CloseoutPreview })
  | (OutcomeBase & { readonly kind: "refused"; readonly preview: CloseoutPreview })
  | (OutcomeBase & AppliedCounts & {
      readonly kind: "applied";
      readonly preview: CloseoutPreview;
      /**
       * Marked accounts counted again in a new transaction after the commit.
       * Above 0 means a demo account was created while the closeout ran. Null
       * means that last look could not be made.
       */
      readonly afterCommit: { readonly markedAccounts: number | null };
    });

export interface CloseoutOptions {
  readonly apply: boolean;
  /** On an apply: the marked students plus marked instructors the preview showed. */
  readonly expectAccounts?: number;
  /** What this checkout says the schema is. See closeout.local.ts. */
  readonly local: LocalSchema;
  /** Where the two switches are read from. Defaults to this process's environment. */
  readonly env?: DemoEnv;
  readonly rule?: SelectionRule;
  /** Ids sent to the database in one statement. */
  readonly chunkSize?: number;
  /** Told which database this is as soon as the server says, before any table is read. */
  readonly onTarget?: (target: CloseoutTarget) => void;
}

/** Postgres takes 32,767 values per statement. Two id lists of this size fit with room to spare. */
const ID_CHUNK = 5_000;
/** Ten minutes: thousands of demo accounts, each with rows in sixty tables, one statement per table. */
const TRANSACTION = { isolationLevel: "Serializable", maxWait: 10_000, timeout: 600_000 } as const;
const KNOWN_STAFF_ROLES = ["teacher", "admin", "coordinator"] as const;

class CloseoutRefused extends Error {
  constructor(readonly refused: Refusal, readonly preview: CloseoutPreview, readonly target?: CloseoutTarget) {
    super(refused.sentence);
  }
}

const idsFor = (run: Run, scope: DeleteStep["scope"]): Ids => (scope === "account" ? run.plan.accountIds : run.plan.classIds);

/** Rows several steps would delete from one model, each counted once. */
async function countDistinct(run: Run, model: string, steps: readonly DeleteStep[]): Promise<number> {
  const seen = new Set<string>();
  for (const step of steps) {
    for (const chunk of chunksOf(idsFor(run, step.scope), run.chunk)) {
      const rows = await tableOf(run.tx, model).findMany({ where: step.where(chunk), select: { id: true } });
      idsOf(rows, "id").forEach((id) => seen.add(id));
    }
  }
  return seen.size;
}

async function plannedRows(run: Run): Promise<Record<string, number>> {
  const byModel = new Map<string, DeleteStep[]>();
  for (const step of DELETE_STEPS) byModel.set(step.model, [...(byModel.get(step.model) ?? []), step]);
  const counts: Record<string, number> = {};
  for (const [model, steps] of byModel) {
    const [only] = steps;
    counts[model] = steps.length === 1 ? await countIn(run, model, only.where, idsFor(run, only.scope)) : await countDistinct(run, model, steps);
  }
  return counts;
}

/** Rows the plan keeps that name a planned account. See GUARDED_REFS. */
async function keptRowsNamingAccounts(run: Run): Promise<number> {
  const planned = new Set([...run.plan.accountIds, ...run.plan.classIds]);
  let total = 0;
  for (const ref of GUARDED_REFS) {
    const { survives } = ref;
    for (const chunk of chunksOf(run.plan.accountIds, run.chunk)) {
      const named = { [ref.column]: { in: chunk } };
      if (survives.kind === "where") {
        total += await tableOf(run.tx, ref.model).count({ where: { AND: [named, survives.where(run.plan.classIds)] } });
      } else {
        const rows = await tableOf(run.tx, ref.model).findMany({ where: named, select: { [survives.key]: true } });
        total += rows.length - idsOf(rows, survives.key).filter((owner) => planned.has(owner)).length;
      }
    }
  }
  return total;
}

/** Unmarked students in a class or region that a planned account teaches, created or coordinates. */
async function unmarkedUnderPlannedStaff(run: Run): Promise<number> {
  const demoClasses = new Set(run.plan.classIds);
  const taught = [
    ...(await valuesWhere(run, "SpokesClassInstructor", "instructorId", "classId", run.plan.accountIds)),
    ...(await valuesWhere(run, "SpokesClass", "createdById", "id", run.plan.accountIds)),
  ];
  const classIds = [...new Set(taught)].filter((id) => !demoClasses.has(id));
  const regionIds = [...new Set([
    ...(await valuesWhere(run, "RegionCoordinator", "coordinatorId", "regionId", run.plan.accountIds)),
    ...(await valuesWhere(run, "RegionInstructor", "instructorId", "regionId", run.plan.accountIds)),
  ])];
  if (classIds.length === 0 && regionIds.length === 0) return 0;
  return tableOf(run.tx, "StudentClassEnrollment").count({
    where: { student: UNMARKED, OR: [{ classId: { in: classIds } }, { class: { regionId: { in: regionIds } } }] },
  });
}

async function countPeople(run: Run): Promise<Pick<CloseoutPreview, "marked" | "unmarked">> {
  const students = tableOf(run.tx, "Student");
  const pages = tableOf(run.tx, "PublicCredentialPage");
  const staff = (role: string) => students.count({ where: { ...UNMARKED, role } });
  return {
    marked: {
      students: await students.count({ where: { demoAccount: "student" } }),
      instructors: await students.count({ where: { demoAccount: "instructor" } }),
      demoClasses: run.plan.classIds.length,
    },
    unmarked: {
      students: await staff("student"),
      staffByRole: {
        teacher: await staff("teacher"),
        admin: await staff("admin"),
        coordinator: await staff("coordinator"),
        other: await students.count({ where: { ...UNMARKED, role: { notIn: ["student", ...KNOWN_STAFF_ROLES] } } }),
      },
      enrolledInDemoClass: await countIn(run, "StudentClassEnrollment", (ids) => ({ classId: { in: ids }, student: UNMARKED }), run.plan.classIds),
      publicCredentialPages: await pages.count({ where: { student: UNMARKED } }),
      publicCredentialPagesSwitchedOn: await pages.count({ where: { student: UNMARKED, isPublic: true } }),
    },
  };
}

/** What the run was asked to do and what it holds, for the checks that depend on it. */
interface Gate {
  readonly env: DemoEnv;
  /** False when an apply could not take the demo student create lock. */
  readonly lockFree: boolean;
  /** True when an apply was given the wrong number of marked accounts, or none. */
  readonly countDiffers: boolean;
}

/** Refusals that mean no count can be trusted, so none is made. */
function unreadableRefusals(server: ServerFacts, local: LocalSchema): Refusal[] {
  const clientModels = new Set<string>(Object.values(Prisma.ModelName));
  const sameModels = local.schemaModels.length === clientModels.size && local.schemaModels.every((model) => clientModels.has(model));
  const sameMigration = server.newestMigration !== null && server.newestMigration === local.newestMigration;
  return [
    refusal("cannot_see_every_row", server.seesEveryRow ? 0 : 1),
    refusal("schema_mismatch", sameModels && sameMigration ? 0 : 1),
  ].filter((entry) => entry.count > 0);
}

/** Everything that can be known to stop an apply without writing a row, in a fixed order. */
async function prewriteRefusals(run: Run, gate: Gate, enrolledInDemoClass: number): Promise<Refusal[]> {
  const classes = tableOf(run.tx, "SpokesClass");
  const withDemoCode = await classes.count({ where: { code: DEMO_CLASS_CODE } });
  const ownedByDemoInstructor = await classes.count({ where: { code: DEMO_CLASS_CODE, createdBy: DEMO_INSTRUCTOR } });
  let attached = 0;
  for (const entry of UNMARKED_ON_DEMO_CLASS) attached += await countIn(run, entry.model, entry.where, run.plan.classIds);
  const found = [
    refusal("demo_mode_on", isCohortDemoEnabled(gate.env) ? 1 : 0),
    refusal("demo_recently_active", gate.lockFree ? 0 : 1),
    refusal("expected_accounts_mismatch", gate.countDiffers ? 1 : 0),
    refusal("demo_class_not_owned", withDemoCode - ownedByDemoInstructor),
    refusal("plan_includes_unmarked", await countIn(run, "Student", (ids) => ({ id: { in: ids }, ...UNMARKED }), run.plan.accountIds)),
    refusal("unmarked_student_in_demo_class", enrolledInDemoClass),
    refusal("unmarked_rows_on_demo_class", attached),
    refusal("marked_staff_over_unmarked_students", await unmarkedUnderPlannedStaff(run)),
    refusal("marked_account_on_kept_rows", await keptRowsNamingAccounts(run)),
  ];
  return found.filter((entry) => entry.count > 0);
}

async function survey(run: Run, gate: Gate): Promise<{ preview: CloseoutPreview; refusals: Refusal[] }> {
  const { env } = gate;
  const people = await countPeople(run);
  const rowsToDelete = await plannedRows(run);
  const preview: CloseoutPreview = {
    demoModeOn: isCohortDemoEnabled(env),
    realStudentDataDeclared: isRealStudentDataDeclared(env),
    ...people,
    rowsToDelete,
    uploadedFilesLeftInStorage: rowsToDelete.FileUpload ?? 0,
  };
  return { preview, refusals: await prewriteRefusals(run, gate, people.unmarked.enrolledInDemoClass) };
}

async function tableCounts(tx: CloseoutTx): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const model of Object.values(Prisma.ModelName)) counts[model] = await tableOf(tx, model).count({});
  return counts;
}

async function deleteStep(run: Run, step: DeleteStep): Promise<void> {
  for (const chunk of chunksOf(idsFor(run, step.scope), run.chunk)) {
    await tableOf(run.tx, step.model).deleteMany({ where: step.where(chunk) });
  }
}

const ACCOUNT_COLUMNS: readonly ClassColumn[] = [
  ...ACCOUNT_STEPS.flatMap((step) => (step.column ? [{ model: step.model, column: step.column }] : [])),
  ...GUARDED_REFS.map((ref) => ({ model: ref.model, column: ref.column })),
];

/** Rows that still hold one of these ids in any column that could. */
async function rowsStillNaming(run: Run, columns: readonly ClassColumn[], ids: Ids): Promise<number> {
  let total = 0;
  for (const { model, column } of columns) total += await countIn(run, model, inList(column), ids);
  return total;
}

function refuseIf(count: number, code: RefusalCode, preview: CloseoutPreview): void {
  if (count > 0) throw new CloseoutRefused(refusal(code, count), preview);
}

/** Rule 3: every table must have shrunk by exactly what the preview listed for it. */
function unlistedChanges(before: Record<string, number>, after: Record<string, number>, planned: Readonly<Record<string, number>>): number {
  return Object.keys(before).reduce((sum, model) => sum + Math.abs(before[model] - after[model] - (planned[model] ?? 0)), 0);
}

/**
 * Deletes the plan. Runs inside the caller's transaction: a refusal or any
 * other throw from here rolls every statement back.
 */
async function applyPlan(run: Run, preview: CloseoutPreview): Promise<AppliedCounts> {
  const before = await tableCounts(run.tx);
  for (const step of [...ACCOUNT_STEPS, ...CLASS_STEPS]) await deleteStep(run, step);
  refuseIf(await rowsStillNaming(run, CLASS_COLUMNS, run.plan.classIds), "rows_left_pointing", preview);
  await deleteStep(run, CLASS_ROOT);
  refuseIf(await rowsStillNaming(run, ACCOUNT_COLUMNS, run.plan.accountIds), "rows_left_pointing", preview);
  await deleteStep(run, ACCOUNT_ROOT);

  const after = await tableCounts(run.tx);
  refuseIf(unlistedChanges(before, after, preview.rowsToDelete), "unlisted_rows_removed", preview);

  const remaining = {
    markedAccounts: await tableOf(run.tx, "Student").count({ where: { demoAccount: { not: null } } }),
    rowsPointingAtDeleted:
      (await rowsStillNaming(run, ACCOUNT_COLUMNS, run.plan.accountIds)) + (await rowsStillNaming(run, CLASS_COLUMNS, run.plan.classIds)),
  };
  if (remaining.markedAccounts > 0 || remaining.rowsPointingAtDeleted > 0) {
    throw new Error("Demo rows remain after the deletion. The transaction is rolled back.");
  }
  const rows = Object.values(preview.rowsToDelete).reduce((sum, count) => sum + count, 0);
  await tableOf(run.tx, "AuditLog").create({
    data: {
      actorRole: "owner", action: "demo.closeout", targetType: "demo",
      summary: "Demo closeout deleted the marked demo accounts, the demo class and their rows.",
      metadata: JSON.stringify({ accounts: run.plan.accountIds.length, classes: run.plan.classIds.length, rows }),
    },
  });
  // The preview's counts are the deleted counts: the row-count check above
  // has just proved every table shrank by exactly these numbers.
  return { deleted: preview.rowsToDelete, remaining };
}

type Applied = Extract<CloseoutOutcome, { kind: "applied" }>;
type BeforeCommit = Exclude<CloseoutOutcome, Applied> | Omit<Applied, "afterCommit">;

/** The whole closeout inside one transaction. Returns before the commit, so `afterCommit` is not known yet. */
async function inTransaction(tx: CloseoutTx, options: CloseoutOptions): Promise<BeforeCommit> {
  await refuseFilteredReads(tx);
  // The lock comes before every other query: see `tryCreateLock`.
  const lockFree = options.apply ? await tryCreateLock(tx) : true;
  const server = await readServerFacts(tx);
  const { target } = server;
  options.onTarget?.(target);
  const unreadable = unreadableRefusals(server, options.local);
  if (unreadable.length > 0) return { kind: "unreadable", target, refusals: unreadable };

  const selection = await (options.rule ?? markedDemoAccountsRule)(tx);
  const run: Run = { tx, plan: { ...selection, jobIds: [] }, chunk: options.chunkSize ?? ID_CHUNK, now: server.now };
  const countDiffers = options.apply && options.expectAccounts !== run.plan.accountIds.length;
  const { preview, refusals } = await survey(run, { env: options.env ?? process.env, lockFree, countDiffers });
  if (!options.apply) return { kind: "preview", target, preview, refusals };
  if (refusals.length > 0) return { kind: "refused", target, preview, refusals };
  try {
    return { kind: "applied", target, preview, refusals: [], ...(await applyPlan(run, preview)) };
  } catch (error) {
    if (error instanceof CloseoutRefused) throw new CloseoutRefused(error.refused, error.preview, target);
    throw error;
  }
}

/**
 * Marked accounts as a new transaction sees them, once the closeout has
 * committed. The closeout's own transaction saw the database as it was when it
 * began, so an account committed while it ran is invisible to it and only this
 * look can find it.
 */
async function markedAfterCommit(client: CloseoutClient): Promise<number | null> {
  try {
    return await client.$transaction(async (tx) => {
      await refuseFilteredReads(tx);
      return await tableOf(tx, "Student").count({ where: { demoAccount: { not: null } } });
    });
  } catch {
    // The closeout itself has committed. Only this last look failed, and the
    // caller is told so: null is reported as "could not be checked".
    return null;
  }
}

/**
 * Previews or applies the closeout in one serializable transaction. A preview
 * only reads. An apply that is refused, at any point, changes nothing: the
 * checks made before the first delete return early, and the ones made after
 * deletes have run throw, which rolls the transaction back.
 */
export async function runDemoCloseout(client: CloseoutClient, options: CloseoutOptions): Promise<CloseoutOutcome> {
  let outcome: BeforeCommit;
  try {
    outcome = await client.$transaction((tx) => inTransaction(tx, options), TRANSACTION);
  } catch (error) {
    if (error instanceof CloseoutRefused && error.target) {
      return { kind: "refused", target: error.target, preview: error.preview, refusals: [error.refused] };
    }
    throw error;
  }
  if (outcome.kind !== "applied") return outcome;
  return { ...outcome, afterCommit: { markedAccounts: await markedAfterCommit(client) } };
}
