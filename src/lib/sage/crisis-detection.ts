import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { sendNotificationWithCooldown } from "@/lib/notifications";
import { enqueueJobWithCooldown } from "@/lib/jobs";
import {
  WELLBEING_ALERT_TYPE,
  WELLBEING_MOOD_LOOKBACK_DAYS,
  WELLBEING_RESPONSE_CHECKLIST,
  formatWellbeingCardSummary,
  type WellbeingMoodSnapshot,
} from "./wellbeing-card";
import { studentLogKey } from "@/lib/log-keys";
import { findAssignedInstructors, listActiveTeachers, type StaffRecipient } from "@/lib/staff-recipients";
import { isDemoStudentIdOrFalse } from "@/lib/demo/accounts";

/**
 * Wellbeing / crisis safety-net.
 *
 * The product has no human-in-the-loop for student distress: Sage's prompt
 * tells a student in crisis to call 988, but until now NOTHING alerted the
 * instructor. For an adult TANF/SNAP population that is the highest day-1
 * liability. This module closes that gap with a deterministic detector (no AI
 * call, runs on every chat turn) plus a low-mood hook, that raise a CRITICAL
 * StudentAlert and actively notify staff.
 *
 * Privacy (locked product decision): NO message text is ever stored on the
 * alert or in the notification, and teachers have NO transcript access. So the
 * alert must be actionable on its own: it carries a structured crisis-context
 * card (trigger category, detection time, recent mood if any, and a
 * recommended-response checklist — see src/lib/sage/wellbeing-card.ts). The
 * detector errs toward alerting (favor recall); the instructor reviews and
 * dismisses false positives, which is cheap and safe.
 */

import type { CrisisCategory } from "./crisis-patterns";

// The patterns and the scan live in crisis-patterns.ts, which has no server
// imports, so the browser can use them too. Re-exported here unchanged.
export {
  detectCrisisSignal,
  type CrisisCategory,
  type CrisisDetection,
  type CrisisLang,
} from "./crisis-patterns";
export type WellbeingReason = "message_signal" | "low_mood";

const ALERT_TYPE = WELLBEING_ALERT_TYPE;
const NOTIFY_TYPE = "wellbeing.concern";
// One open concern per student per UTC day so repeated signals in a session
// update a single alert instead of spamming. A new day — or a staff-resolved
// alert — produces a fresh one. (UTC is fine here; this is only a dedup key,
// not a grant metric.)
function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function reasonText(reason: WellbeingReason): string {
  return reason === "low_mood" ? "a very low mood score" : "something they said in chat";
}

// The instructor query and its enrollment-status list live in
// src/lib/staff-recipients.ts, shared with the intervention-nudge path
// (D8, 2026-09-07) so the two safety-relevant recipient lookups cannot drift.

/**
 * Who gets actively notified about a wellbeing concern.
 *
 * SAFETY: the audience must NEVER be narrower than the pre-scoping behavior
 * (all active teachers). Assigned class instructors are preferred so the most
 * sensitive signal in the system isn't over-disclosed program-wide, but zero
 * resolved instructors OR any resolution failure falls back to every active
 * teacher — over-notifying is the safe failure mode.
 *
 * The one exception is a cohort demo account (src/lib/demo/accounts.ts). Its
 * alert never widens to real teachers: it reaches whoever is assigned to the
 * demo student, which is the demo instructor, who has no email address. A real
 * student is never narrowed by this, including when the demo lookup fails.
 */
async function resolveWellbeingRecipients(studentId: string): Promise<StaffRecipient[]> {
  let assigned: StaffRecipient[] = [];
  try {
    assigned = await findAssignedInstructors(studentId);
  } catch (err) {
    logger.error("Wellbeing: instructor resolution failed; falling back to all active teachers", {
      student: studentLogKey(studentId),
      alert: "wellbeing_instructor_resolution_failed",
      error: errorForLog(err),
    });
  }

  if (assigned.length > 0) return assigned;

  // prismaAdmin for the same reason as findAssignedInstructors: through the
  // app client this query returns zero rows under the student's context, and
  // a silent empty fallback is exactly the failure the fallback exists to stop.
  // A demo student skips it: the fallback would carry a made-up student's
  // alert to real teachers' inboxes, and `assigned` is already empty here.
  const everyone = (await isDemoStudent(studentId)) ? assigned : await listActiveTeachers();

  if (everyone.length === 0) {
    // A CRITICAL alert with nobody to notify must never be quiet. This is the
    // signal that would have exposed F2 in production, and it is what fires
    // if ADMIN_DATABASE_URL is unset: prismaAdmin then falls back to vq_app
    // with empty GUCs and every staff read returns [] (src/lib/db.ts).
    logger.error("Wellbeing: no staff recipients resolved; nobody was notified", {
      student: studentLogKey(studentId),
      alert: "wellbeing_no_recipients",
    });
  }

  return everyone;
}

/**
 * Whether the student is a cohort demo account. A failed lookup counts as "no"
 * (the shared policy in src/lib/demo/accounts.ts) and is logged here.
 */
function isDemoStudent(studentId: string): Promise<boolean> {
  return isDemoStudentIdOrFalse(studentId, (err) => {
    logger.error("Wellbeing: demo-account check failed; treating the student as a real account", {
      student: studentLogKey(studentId),
      alert: "wellbeing_demo_check_failed",
      error: errorForLog(err),
    });
  });
}

/**
 * Most recent self-reported mood within the card lookback window. Best-effort:
 * a failed lookup only costs the mood line on the card, never the alert.
 */
async function findRecentMood(studentId: string, now: Date): Promise<WellbeingMoodSnapshot | null> {
  try {
    const lookbackStart = new Date(
      now.getTime() - WELLBEING_MOOD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const entry = await prisma.moodEntry.findFirst({
      where: { studentId, extractedAt: { gte: lookbackStart } },
      orderBy: { extractedAt: "desc" },
      select: { score: true, extractedAt: true },
    });
    if (!entry) return null;
    return { score: entry.score, recordedAt: entry.extractedAt };
  } catch (err) {
    logger.error("Wellbeing: mood lookup for crisis card failed", {
      student: studentLogKey(studentId),
      alert: "wellbeing_mood_lookup_failed",
      error: errorForLog(err),
    });
    return null;
  }
}

/**
 * Raise a CRITICAL wellbeing alert for a student and actively notify staff.
 * Idempotent within a day via the alertKey. Best-effort: never throws (callers
 * are fire-and-forget on the chat path) — failures are logged loudly.
 */
export async function recordWellbeingConcern({
  studentId,
  conversationId,
  reason,
  category = null,
  now = new Date(),
}: {
  studentId: string;
  conversationId: string | null;
  reason: WellbeingReason;
  /**
   * Trigger category from detectCrisisSignal for message_signal reasons.
   * Category ONLY — never message text.
   */
  category?: CrisisCategory | null;
  now?: Date;
}): Promise<void> {
  const alertKey = `wellbeing:${studentId}:${dayBucket(now)}`;

  // 1. CRITICAL StudentAlert — surfaces at the top of the teacher dashboard.
  //    The dashboard query already scopes alerts to the teacher's managed
  //    students (RLS + studentId filter), so only the right staff see it.
  try {
    // Structured crisis-context card (category + time + recent mood + response
    // checklist) encoded as plain text: StudentAlert has no JSON column, and
    // teachers have no transcript access, so the summary itself must make the
    // alert actionable. NEVER any message text. The update branch refreshes
    // the card too, so a repeated same-day signal keeps category/time/mood
    // current (latest signal wins for the daily alert row).
    const summary = formatWellbeingCardSummary({
      category: reason === "low_mood" ? "low_mood" : category,
      detectedAt: now,
      mood: await findRecentMood(studentId, now),
    });

    await prisma.studentAlert.upsert({
      where: { alertKey },
      update: {
        status: "open",
        severity: "critical",
        detectedAt: now,
        summary,
        resolvedAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
      },
      create: {
        studentId,
        alertKey,
        type: ALERT_TYPE,
        severity: "critical",
        status: "open",
        title: "Wellbeing check-in needed",
        summary,
        sourceType: "conversation",
        sourceId: conversationId,
      },
    });
  } catch (err) {
    logger.error("Wellbeing: failed to upsert StudentAlert", {
      student: studentLogKey(studentId),
      reason,
      alert: "wellbeing_alert_failed",
      error: errorForLog(err),
    });
  }

  // 2. Actively notify staff (in-app always; email best-effort). Prefer the
  //    student's assigned class instructors; if none resolve (unenrolled
  //    student, data gap, or a failed lookup) fall back to ALL active teachers.
  //    The audience is never narrower than the pre-scoping behavior — for a
  //    crisis signal, over-notifying is the safe failure mode.
  //    Staff Notification rows are written with `client: "admin"`: under the
  //    student's RLS context `notification_access` WITH CHECK rejects a row
  //    whose studentId is a teacher, and allSettled would swallow it. The
  //    email job path already runs on prismaAdmin (src/lib/jobs.ts).
  try {
    const [student, recipients] = await Promise.all([
      prisma.student.findUnique({
        where: { id: studentId },
        select: { displayName: true, studentId: true },
      }),
      resolveWellbeingRecipients(studentId),
    ]);

    const studentName = student?.displayName || student?.studentId || "A student";
    const title = "Wellbeing check-in needed";
    const body = `${studentName} may need support based on ${reasonText(reason)}. Please check in with them directly.`;
    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") || "";
    // Static checklist only — no category and no message text in email, which
    // is the least-protected channel.
    const checklistText = WELLBEING_RESPONSE_CHECKLIST.map(
      (item, index) => `${index + 1}. ${item}`,
    ).join("\n");

    await Promise.allSettled(
      recipients.map((recipient) =>
        // 12h cooldown so repeated signals in a day don't re-ping, but the
        // alert itself stays open and visible on the dashboard.
        sendNotificationWithCooldown(recipient.id, { type: NOTIFY_TYPE, title, body }, 12, {
          client: "admin",
        }),
      ),
    );

    await Promise.allSettled(
      recipients.flatMap((recipient) => {
        if (!recipient.email) return [];
        const dedupeHash = createHash("sha1")
          .update(`${recipient.id}:${studentId}:${NOTIFY_TYPE}:${dayBucket(now)}`)
          .digest("hex");
        return [
          enqueueJobWithCooldown({
            type: "send_email",
            dedupeKey: `wellbeing:${dedupeHash}`,
            cooldownHours: 12,
            payload: {
              to: recipient.email,
              subject: `VisionQuest: ${title}`,
              text:
                `${body}\n\n` +
                `Recommended response:\n${checklistText}\n\n` +
                `${baseUrl ? `Open VisionQuest: ${baseUrl}\n\n` : ""}` +
                "This is an automated wellbeing alert. No student message text is included for privacy — " +
                "review the crisis card in VisionQuest and reach out to the student directly.",
            },
          }),
        ];
      }),
    );
  } catch (err) {
    logger.error("Wellbeing: failed to notify staff", {
      student: studentLogKey(studentId),
      reason,
      alert: "wellbeing_notify_failed",
      error: errorForLog(err),
    });
  }
}
