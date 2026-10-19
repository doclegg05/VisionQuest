/**
 * What the shared demo instructor may do over HTTP.
 *
 * The demo instructor is one real teacher account that every visitor to the
 * cohort demo shares. In app code any teacher can manage any class or student
 * (`STAFF_CAN_MANAGE_ANY`, src/lib/classroom.ts), so left alone this account
 * could change the program's real content. src/proxy.ts asks this file about
 * every request that carries a demo instructor session, with no database
 * lookup, and answers 403 when the answer is no.
 *
 * The rule is default-deny:
 *   - Only `/api/` paths are policed.
 *   - GET, HEAD and OPTIONS pass unless they match DEMO_INSTRUCTOR_READ_DENY.
 *     HEAD runs the GET handler, so it is held to the GET patterns.
 *   - Any other method passes only if it matches DEMO_INSTRUCTOR_WRITE_ALLOW.
 *     A route added tomorrow is refused until someone lists it here.
 *
 * DEMO_INSTRUCTOR_WRITE_DENY changes no answer. It is the record that every
 * other state-changing route was looked at and left out on purpose.
 * instructor-policy.test.ts walks src/app/api and fails when a handler is in
 * neither list, or when an entry names a handler that is not there.
 *
 * A route belongs in WRITE_ALLOW only if it writes the caller's own rows
 * (notifications, its own conversations) or acts on one student or one class
 * through `assertStaffCanManageStudent` or `assertStaffCanManageClass`. A
 * route that sends a message, sets a credential, creates an account, or
 * changes program-wide content stays out.
 *
 * Pattern grammar. Each pattern is "<METHOD> <path>":
 *   [name]     matches exactly one path segment
 *   [...name]  matches one or more segments, to the end
 *   /**        at the end, matches the folder itself and anything below it
 * A `(group)` folder is not part of a URL, so it never appears in a pattern.
 *
 * `src/proxy.ts` imports this file, so it must stay free of Prisma and of
 * anything else that is heavy or server-only.
 */

/** Writes the demo instructor may make: its own rows, or one class or student. */
export const DEMO_INSTRUCTOR_WRITE_ALLOW: readonly string[] = [
  "PATCH /api/teacher/alerts/[id]",
  "PATCH /api/teacher/appointments/[id]",
  "POST /api/teacher/availability",
  "DELETE /api/teacher/availability/[id]",
  "PATCH /api/teacher/classes/[id]/enrollments/[enrollmentId]",
  "POST /api/teacher/classes/[id]/requirements",
  "PUT /api/teacher/classes/[id]/requirements",
  "DELETE /api/teacher/classes/[id]/requirements",
  "POST /api/teacher/connect/connections",
  "POST /api/teacher/connect/connections/[id]/close",
  "POST /api/teacher/connect/connections/endorsement-draft",
  "POST /api/teacher/failed-extractions/[id]",
  "DELETE /api/teacher/forms/assignments/[id]",
  "PATCH /api/teacher/forms/responses/[id]",
  "POST /api/teacher/forms/templates/[id]/assign",
  "POST /api/teacher/outcomes/verify",
  "POST /api/teacher/students/[id]/appointments",
  "POST /api/teacher/students/[id]/archive",
  "PATCH /api/teacher/students/[id]/discovery",
  "PATCH /api/teacher/students/[id]/forms",
  "PATCH /api/teacher/students/[id]/goals/[goalId]",
  "PATCH /api/teacher/students/[id]/memories",
  "DELETE /api/teacher/students/[id]/memories",
  "POST /api/teacher/students/[id]/notes",
  "PATCH /api/teacher/students/[id]/notes",
  "DELETE /api/teacher/students/[id]/notes",
  "PUT /api/teacher/students/[id]/spokes",
  "POST /api/teacher/students/[id]/spokes/checklist",
  "POST /api/teacher/students/[id]/spokes/follow-up",
  "DELETE /api/teacher/students/[id]/spokes/follow-up",
  "POST /api/teacher/students/[id]/spokes/modules",
  "DELETE /api/teacher/students/[id]/spokes/modules",
  "PATCH /api/teacher/students/[id]/status",
  "POST /api/teacher/students/[id]/tasks",
  "POST /api/goal-resource-links",
  "PATCH /api/goal-resource-links/[id]",
  "POST /api/forms/sign",
  "POST /api/forms/upload",
  "POST /api/orientation",
  "POST /api/orientation/complete",
  "PATCH /api/tasks/[id]",
  "POST /api/sage/insights",
  "PATCH /api/sage/insights/[id]",
  "DELETE /api/sage/insights/[id]",
  "POST /api/chat/send",
  "POST /api/chat/tool-confirm",
  "DELETE /api/auth/session",
  "POST /api/notifications",
  "DELETE /api/chat/conversations/[id]",
  "POST /api/sage/panel/dismiss",
  // The demo sign-in endpoints. A demo instructor who is still signed in may
  // pick the student side, or sign in as the instructor again, from the sign-in page.
  "POST /api/demo/student",
  "POST /api/demo/instructor",
];

/**
 * Every other state-changing route under src/app/api: program-wide content,
 * credentials, accounts, messages that leave the app, student-only actions,
 * and the cron and webhook endpoints. Generated once from a walk of the route
 * files, then read by hand against the rule above.
 */
export const DEMO_INSTRUCTOR_WRITE_DENY: readonly string[] = [
  "DELETE /api/admin/ai-config",
  "PUT /api/admin/ai-config",
  "POST /api/admin/ai-config/test",
  "PUT /api/admin/ai-provider",
  "POST /api/admin/ai-provider/test",
  "PUT /api/admin/placement-bridge",
  "POST /api/admin/regions",
  "PATCH /api/admin/regions/[id]",
  "POST /api/admin/regions/[id]/coordinators",
  "DELETE /api/admin/regions/[id]/coordinators/[coordinatorId]",
  "POST /api/admin/students/[id]/offboard",
  "DELETE /api/admin/webhooks",
  "PATCH /api/admin/webhooks",
  "POST /api/admin/webhooks",

  "POST /api/applications",

  "POST /api/appointments/book",

  "POST /api/auth/forgot-password",
  "POST /api/auth/login",
  "POST /api/auth/mfa/backup-codes",
  "POST /api/auth/mfa/challenge",
  "POST /api/auth/mfa/disable",
  "POST /api/auth/mfa/setup",
  "POST /api/auth/mfa/verify",
  "POST /api/auth/register-teacher",
  "POST /api/auth/reset-password",
  "POST /api/auth/reset-password/questions",

  "POST /api/certifications",

  "POST /api/chat/upload",

  "POST /api/connect/[id]/approve",
  "POST /api/connect/[id]/withdraw",
  "POST /api/connect/employer/[token]/hired",
  "POST /api/connect/employer/[token]/interested",
  "POST /api/connect/employer/[token]/not-now",

  "POST /api/coordinator/grant-goals",
  "DELETE /api/coordinator/grant-goals/[id]",
  "PATCH /api/coordinator/grant-goals/[id]",

  "POST /api/credentials/share",

  "POST /api/csp-report",

  "DELETE /api/events/[id]/register",
  "POST /api/events/[id]/register",

  "DELETE /api/files",
  "POST /api/files",

  "POST /api/goals",
  "PATCH /api/goals/[id]",

  "POST /api/internal/alerts/sync",
  "POST /api/internal/appointments/reminders",
  "POST /api/internal/cron-health",
  "POST /api/internal/evidence-gap-detection",
  "POST /api/internal/goal-stale-detection",
  "POST /api/internal/jobs/browse-refresh",
  "POST /api/internal/jobs/process",
  "POST /api/internal/jobs/scrape",
  "POST /api/internal/memory/consolidate",
  "POST /api/internal/nudges/run",
  "POST /api/internal/rag/backfill",
  "POST /api/internal/sage/briefing",
  "POST /api/internal/wagers/resolve",

  "POST /api/jobs/save",

  "POST /api/lms/platforms/visit",

  "POST /api/mood",

  "PUT /api/notifications/preferences",
  "POST /api/notifications/preferences/verify-phone",
  "POST /api/notifications/preferences/verify-phone/confirm",

  "POST /api/orientation/welcome-video",

  "DELETE /api/portfolio",
  "POST /api/portfolio",
  "PUT /api/portfolio",

  "POST /api/progression/checkin",

  "POST /api/resume",
  "POST /api/resume/application-file",
  "POST /api/resume/assist",
  "POST /api/resume/upload",

  "POST /api/sage/panel/refresh",
  "POST /api/sage/tools/propose-goal",

  "DELETE /api/settings/api-key",
  "POST /api/settings/api-key",
  "POST /api/settings/consent",
  "DELETE /api/settings/credly",
  "POST /api/settings/credly",
  "POST /api/settings/profile",
  "POST /api/settings/security-questions",

  "POST /api/sms/inbound",

  "PUT /api/student/forms/[templateId]",
  "POST /api/student/forms/[templateId]/submit",

  "POST /api/teacher/appointments/reminders",
  "DELETE /api/teacher/certifications",
  "POST /api/teacher/certifications",
  "PUT /api/teacher/certifications",
  "POST /api/teacher/classes",
  "PATCH /api/teacher/classes/[id]",
  "POST /api/teacher/classes/[id]/students",
  "POST /api/teacher/connect/batch-workforce-wv",
  "POST /api/teacher/connect/connections/[id]/send",
  "POST /api/teacher/connect/employers",
  "PUT /api/teacher/connect/employers",
  "POST /api/teacher/connect/employers/[id]/contacts",
  "POST /api/teacher/connect/leads",
  "PUT /api/teacher/connect/leads",
  "POST /api/teacher/connect/leads/from-listing",
  "PATCH /api/teacher/documents/sage-context",
  "POST /api/teacher/documents/sage-context/sync",
  "DELETE /api/teacher/events",
  "POST /api/teacher/events",
  "PUT /api/teacher/events",
  "POST /api/teacher/forms/templates",
  "PATCH /api/teacher/forms/templates/[id]",
  "PUT /api/teacher/jobs/config",
  "POST /api/teacher/jobs/refresh",
  "DELETE /api/teacher/lms",
  "POST /api/teacher/lms",
  "PUT /api/teacher/lms",
  "DELETE /api/teacher/opportunities",
  "POST /api/teacher/opportunities",
  "PUT /api/teacher/opportunities",
  "DELETE /api/teacher/orientation",
  "POST /api/teacher/orientation",
  "PUT /api/teacher/orientation",
  "POST /api/teacher/pathways",
  "DELETE /api/teacher/pathways/[id]",
  "PATCH /api/teacher/pathways/[id]",
  "DELETE /api/teacher/sage-snippets",
  "PATCH /api/teacher/sage-snippets",
  "POST /api/teacher/sage-snippets",
  "DELETE /api/teacher/spokes/config",
  "POST /api/teacher/spokes/config",
  "PUT /api/teacher/spokes/config",
  "DELETE /api/teacher/spokes/referrals",
  "POST /api/teacher/spokes/referrals",
  "POST /api/teacher/students/[id]/reassign-class",
  "POST /api/teacher/students/[id]/reset-password",
  "DELETE /api/teacher/welcome-letter",
  "POST /api/teacher/welcome-letter",

  "DELETE /api/vision-board",
  "POST /api/vision-board",
  "PUT /api/vision-board",

  "POST /api/welcome/complete",

  "PUT /api/work-profile",
];

/**
 * Reads that would show another class, or staff names and emails. Reads of
 * program-wide content are allowed on purpose.
 *
 * This is the one list that fails open, because a pattern that matches no real
 * route denies nothing. instructor-policy.test.ts checks that each entry lands
 * on a GET handler that exists. The folders that hold a whole family of reads
 * use `/**`, so a route added under one of them later is denied from the start.
 */
export const DEMO_INSTRUCTOR_READ_DENY: readonly string[] = [
  "GET /api/teacher/reports/**",
  "GET /api/teacher/spokes/referrals",
  "GET /api/teacher/failed-extractions",
  "GET /api/teacher/forms/responses",
  "GET /api/teacher/export/**",
  "GET /api/teacher/audit/**",
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Splits a path into decoded, non-empty segments, so `//api/x/`, `/api/x/` and
 * `/api/%78` all read as `api`, `x`. Splitting comes before decoding so an
 * encoded slash stays inside its segment, as it does when Next.js routes it.
 * Returns null for a broken escape: nothing sensible can be matched against it.
 */
function pathSegments(pathname: string): string[] | null {
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    if (raw === "") continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return segments;
}

function isParam(segment: string): boolean {
  return segment.length > 2 && segment.startsWith("[") && segment.endsWith("]") && !segment.startsWith("[...");
}

function isRestParam(segment: string): boolean {
  return segment.length > 5 && segment.startsWith("[...") && segment.endsWith("]");
}

function matchesSegments(pattern: string[], segments: string[]): boolean {
  // A trailing /** takes the folder and everything below it.
  const wildcard = pattern[pattern.length - 1] === "**";
  const fixed = wildcard ? pattern.slice(0, -1) : pattern;

  for (let index = 0; index < fixed.length; index += 1) {
    const expected = fixed[index];
    if (isRestParam(expected)) {
      // [...name] has to be the last pattern segment and needs at least one segment.
      return index === fixed.length - 1 && !wildcard && segments.length > index;
    }
    const actual = segments[index];
    if (actual === undefined) return false;
    if (!isParam(expected) && expected !== actual) return false;
  }

  return wildcard ? segments.length >= fixed.length : segments.length === fixed.length;
}

/** Whether "<METHOD> <path>" `pattern` covers this request. A malformed pattern covers nothing. */
export function matchesRoutePattern(pattern: string, method: string, pathname: string): boolean {
  const split = pattern.indexOf(" ");
  if (split < 1) return false;

  if (pattern.slice(0, split) !== method.toUpperCase()) return false;

  const segments = pathSegments(pathname);
  if (segments === null) return false;

  const patternSegments = pattern.slice(split + 1).split("/").filter((segment) => segment !== "");
  if (patternSegments.length === 0) return false;

  return matchesSegments(patternSegments, segments);
}

/**
 * Whether the shared demo instructor may make this request. See the header of
 * this file for the rule. A path with a broken escape is refused outright.
 */
export function isDemoInstructorRequestAllowed(method: string, pathname: string): boolean {
  const segments = pathSegments(pathname);
  if (segments === null) return false;
  if (segments[0] !== "api") return true;

  const verb = method.toUpperCase();
  if (READ_METHODS.has(verb)) {
    const readVerb = verb === "HEAD" ? "GET" : verb;
    return !DEMO_INSTRUCTOR_READ_DENY.some((pattern) => matchesRoutePattern(pattern, readVerb, pathname));
  }

  return DEMO_INSTRUCTOR_WRITE_ALLOW.some((pattern) => matchesRoutePattern(pattern, verb, pathname));
}
