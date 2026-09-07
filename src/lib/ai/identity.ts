/**
 * The one loader that tells a `TokenVault` which values belong to the person
 * a request is about (FERPA review 2026-09-06, Sprint 3 / memo B §2.a).
 *
 * `resolveAiProvider` calls this on the cloud branch, so a call site cannot
 * forget to populate the vault — the failure mode the review's §2.0 names
 * explicitly, and the one this repo keeps re-learning (F63, the platform-map
 * drift, the four-copy money regex).
 *
 * Two properties everything else here leans on:
 *
 *  1. **It never widens what the caller's own RLS context can see.** Every
 *     read goes through the app client (`prisma`), never `prismaAdmin`. A
 *     value the caller cannot read is a value that was not going into their
 *     prompt either, so it does not need vaulting.
 *  2. **It never throws.** It runs inside provider resolution on the chat hot
 *     path. A blocked, slow or failing lookup degrades to an absent field —
 *     the vault is then smaller, which is exactly today's (unvaulted)
 *     behaviour for that field, and never a 500 on a student's chat turn.
 *     `resolveAiProvider`'s own fail-closed contract is about the POLICY
 *     refusal, which runs before this and is unaffected.
 *
 * What is deliberately NOT loaded, and why:
 *
 *  - **A student's assigned instructors.** Under `vq_app` the student branch
 *    of `student_self_access` hides every teacher row, so the enrolment →
 *    instructor join returns nothing in the student's own context — see the
 *    RLS note on `findAssignedInstructors` in
 *    `src/lib/sage/crisis-detection.ts`, which is why THAT function uses
 *    `prismaAdmin`. Reaching for the admin client here would put staff names
 *    into a vault built from a student's request, which is exactly the
 *    widening rule 1 forbids. The cost is that an instructor's name typed by
 *    a student in free text is not tokenized; memo B §2.b already records
 *    third-party names as the residual this layer cannot close.
 *  - **`SpokesRecord.birthDate`, race, TANF/SNAP status.** Wave 1B pins that
 *    these never reach a prompt at all (`prompt-identifier-pins.test.ts`), so
 *    there is nothing to substitute.
 */

import { prisma } from "@/lib/db";
import { buildManagedStudentWhere } from "@/lib/classroom";
import { cached, invalidatePrefix } from "@/lib/cache";
import type { Session } from "@/lib/api-error";
import type { IdentityInput } from "./deidentify";

/**
 * Same cap `staff-student-context.ts` puts on the roster it loads for the
 * ambiguous-name branch: one number, so the set of names the vault can
 * tokenize is never smaller than the set the prompt can mention.
 */
export const MANAGED_ROSTER_CAP = 500;

/**
 * The chat route and `handlePostResponse` both resolve a provider for the
 * same turn, and post-response resolves once more per extractor. 60 s is long
 * enough to make those free and short enough that a display-name change shows
 * up within a minute.
 */
export const IDENTITY_CACHE_TTL_SECONDS = 60;

const CACHE_PREFIX = "ai-identity:";

export interface LoadIdentityArgs {
  /** The session subject: a student id for student chat, a staff id otherwise. */
  studentId: string;
  /** Session role, when the caller knows it. Read from the row when absent. */
  sessionRole?: string | null;
  /** Session display name, when the caller knows it. Saves a row read for staff. */
  sessionDisplayName?: string | null;
}

function isStaff(role: string): boolean {
  return role === "teacher" || role === "admin" || role === "coordinator";
}

/** A trimmed non-empty string, or undefined. Never vault an empty value. */
function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Run a lookup, swallowing any failure into `fallback`. Nothing is logged:
 * the payload would have to carry a student identifier to be useful, and the
 * repo's no-PII-in-logs rule forbids that. An identity that failed to load is
 * visible instead as a `routed` audit event whose `tokens` list is short.
 */
async function optional<T>(fetch: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fetch();
  } catch {
    return fallback;
  }
}

/**
 * Display names of the students this session manages, capped and ordered the
 * same way `buildStaffStudentContext` orders the candidates it may name in
 * the prompt. Scoped by `buildManagedStudentWhere`, so a coordinator's
 * fail-closed clause yields [] here exactly as it does everywhere else.
 */
export async function listManagedRosterNames(session: Session): Promise<string[]> {
  const rows = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, { includeInactiveAccounts: false }),
    select: { displayName: true },
    orderBy: { displayName: "asc" },
    take: MANAGED_ROSTER_CAP,
  });
  return rows.map((row) => row.displayName).filter((name) => Boolean(name?.trim()));
}

async function loadStudentIdentity(studentId: string, row: StudentRow | null): Promise<IdentityInput> {
  const preference = await optional(
    () =>
      prisma.notificationPreference.findFirst({
        where: { studentId, channel: "sms" },
        select: { destination: true },
      }),
    null,
  );

  const identity: IdentityInput = {};
  const name = clean(row?.displayName);
  if (name) identity.studentName = name;
  const email = clean(row?.email);
  if (email) identity.studentEmail = email;
  // The login username, printed publicly on the credential page (F12) and
  // therefore an identifier wherever it appears.
  const loginId = clean(row?.studentId);
  if (loginId) identity.studentLoginId = loginId;
  const phone = clean(preference?.destination);
  if (phone) identity.studentPhone = phone;
  return identity;
}

async function loadStaffIdentity(
  session: Session,
  displayName: string | undefined,
): Promise<IdentityInput> {
  const rosterNames = await optional(() => listManagedRosterNames(session), []);
  const identity: IdentityInput = {};
  if (displayName) identity.staffNames = [displayName];
  if (rosterNames.length > 0) identity.rosterNames = rosterNames;
  return identity;
}

interface StudentRow {
  displayName: string;
  email: string | null;
  studentId: string;
  role: string;
}

/**
 * Everything the vault can substitute for one request, by role.
 *
 * Student session: their own display name, email, login username and the SMS
 * destination they gave — the four values the app puts into prompts by name.
 * Staff session: their own display name plus the managed roster, because a
 * staff prompt names other people and a student's own does not.
 */
export async function loadIdentityInput(args: LoadIdentityArgs): Promise<IdentityInput> {
  const role = clean(args.sessionRole)?.toLowerCase() ?? "";
  const key = `${CACHE_PREFIX}${role || "unknown"}:${args.studentId}`;
  return cached(key, IDENTITY_CACHE_TTL_SECONDS, async () => {
    const sessionName = clean(args.sessionDisplayName);

    // A staff caller that already told us its role and name needs no row read
    // at all; anything else reads the row once and uses it for both.
    if (role && isStaff(role)) {
      const session: Session = {
        id: args.studentId,
        studentId: "",
        displayName: sessionName ?? "",
        role,
      };
      if (sessionName) return loadStaffIdentity(session, sessionName);
      const row = await optional(() => readRow(args.studentId), null);
      return loadStaffIdentity(session, clean(row?.displayName));
    }

    const row = await optional(() => readRow(args.studentId), null);
    const effectiveRole = role || clean(row?.role)?.toLowerCase() || "student";
    if (isStaff(effectiveRole)) {
      const session: Session = {
        id: args.studentId,
        studentId: "",
        displayName: sessionName ?? row?.displayName ?? "",
        role: effectiveRole,
      };
      return loadStaffIdentity(session, sessionName ?? clean(row?.displayName));
    }
    return loadStudentIdentity(args.studentId, row);
  });
}

function readRow(studentId: string): Promise<StudentRow | null> {
  return prisma.student.findUnique({
    where: { id: studentId },
    select: { displayName: true, email: true, studentId: true, role: true },
  }) as Promise<StudentRow | null>;
}

/** Test seam: drop every cached identity. Not called by production code. */
export function clearIdentityCache(): void {
  invalidatePrefix(CACHE_PREFIX);
}
