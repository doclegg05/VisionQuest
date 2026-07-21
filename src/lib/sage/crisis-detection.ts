import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendNotificationWithCooldown } from "@/lib/notifications";
import { enqueueJobWithCooldown } from "@/lib/jobs";

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
 * Privacy: NO message text is ever stored on the alert or in the notification.
 * The instructor opens the conversation to read context. The detector errs
 * toward alerting (favor recall); the instructor reviews and dismisses false
 * positives, which is cheap and safe.
 */

export type CrisisCategory = "self_harm" | "harm_others" | "abuse";
export type WellbeingReason = "message_signal" | "low_mood";

interface CrisisPattern {
  category: CrisisCategory;
  pattern: RegExp;
}

// Phrase-level, word-boundary matched, case-insensitive. Phrases (not bare
// words) keep false positives down — e.g. we match "want to die" but not the
// idiom "dying to", and "kill myself" but not "killer deal". Tunable.
const CRISIS_PATTERNS: CrisisPattern[] = [
  { category: "self_harm", pattern: /\b(kill(ing)?\s+myself|killed\s+myself)\b/i },
  { category: "self_harm", pattern: /\b(end(ing)?\s+(my\s+life|it\s+all)|take\s+my\s+(own\s+)?life)\b/i },
  { category: "self_harm", pattern: /\bsuicid(e|al)\b/i },
  { category: "self_harm", pattern: /\b(want|going|need)\s+to\s+die\b/i },
  { category: "self_harm", pattern: /\b(wish\s+i\s+(was|were)\s+dead|better\s+off\s+dead|no\s+reason\s+to\s+(live|be\s+here)|don'?t\s+want\s+to\s+(live|be\s+here)|can'?t\s+go\s+on)\b/i },
  // Passive ideation phrased around absence rather than death — "better off
  // without me" / "if I just disappeared". Surfaced by the sage-redteam-eval
  // crisis-paraphrase scenario, which this detector previously missed.
  { category: "self_harm", pattern: /\b(better\s+off\s+(without\s+me|if\s+i\s+(just\s+)?disappeared)|want\s+to\s+(just\s+)?disappear)\b/i },
  { category: "self_harm", pattern: /\b((hurt|harm|cut)(ting|t)?\s+myself|self[-\s]?harm(ing)?)\b/i },
  { category: "harm_others", pattern: /\b(want|going)\s+to\s+(hurt|kill)\s+(someone|him|her|them|people|everyone)\b/i },
  { category: "abuse", pattern: /\b(be(ing)?\s+abused|he\s+hits\s+me|she\s+hits\s+me|they\s+hit\s+me|hits?\s+me\s+at\s+home|hurt(s|ing)?\s+me\s+at\s+home|being\s+(hurt|hit)\s+at\s+home)\b/i },
];

export interface CrisisDetection {
  matched: boolean;
  category: CrisisCategory | null;
}

/**
 * Deterministic scan of a single message for self-harm, harm-to-others, or
 * abuse signals. Pure + synchronous + no AI — safe to call on every turn.
 */
export function detectCrisisSignal(text: string): CrisisDetection {
  if (!text || typeof text !== "string") return { matched: false, category: null };
  for (const { category, pattern } of CRISIS_PATTERNS) {
    if (pattern.test(text)) return { matched: true, category };
  }
  return { matched: false, category: null };
}

const ALERT_TYPE = "wellbeing_concern";
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

/**
 * Raise a CRITICAL wellbeing alert for a student and actively notify staff.
 * Idempotent within a day via the alertKey. Best-effort: never throws (callers
 * are fire-and-forget on the chat path) — failures are logged loudly.
 */
export async function recordWellbeingConcern({
  studentId,
  conversationId,
  reason,
  now = new Date(),
}: {
  studentId: string;
  conversationId: string | null;
  reason: WellbeingReason;
  now?: Date;
}): Promise<void> {
  const alertKey = `wellbeing:${studentId}:${dayBucket(now)}`;

  // 1. CRITICAL StudentAlert — surfaces at the top of the teacher dashboard.
  //    The dashboard query already scopes alerts to the teacher's managed
  //    students (RLS + studentId filter), so only the right staff see it.
  try {
    await prisma.studentAlert.upsert({
      where: { alertKey },
      update: {
        status: "open",
        severity: "critical",
        detectedAt: now,
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
        // Minimal: NO quoted message text is ever stored here.
        summary:
          "A student may have shared something serious in a Sage conversation. " +
          "Please check in with them directly. No message text is stored here for privacy — " +
          "open their conversation to see the context.",
        sourceType: "conversation",
        sourceId: conversationId,
      },
    });
  } catch (err) {
    logger.error("Wellbeing: failed to upsert StudentAlert", {
      studentId,
      reason,
      alert: "wellbeing_alert_failed",
      error: String(err),
    });
  }

  // 2. Actively notify staff (in-app always; email best-effort). For a crisis
  //    signal we deliberately notify ALL active teachers — over-notifying is
  //    the safe failure mode. (At multi-classroom scale, consider scoping to
  //    the student's managing instructors.)
  try {
    const [student, teachers] = await Promise.all([
      prisma.student.findUnique({
        where: { id: studentId },
        select: { displayName: true, studentId: true },
      }),
      prisma.student.findMany({
        where: { role: "teacher", isActive: true },
        select: { id: true, email: true },
      }),
    ]);

    const studentName = student?.displayName || student?.studentId || "A student";
    const title = "Wellbeing check-in needed";
    const body = `${studentName} may need support based on ${reasonText(reason)}. Please check in with them directly.`;
    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") || "";

    await Promise.allSettled(
      teachers.map((teacher) =>
        // 12h cooldown so repeated signals in a day don't re-ping, but the
        // alert itself stays open and visible on the dashboard.
        sendNotificationWithCooldown(teacher.id, { type: NOTIFY_TYPE, title, body }, 12),
      ),
    );

    await Promise.allSettled(
      teachers.flatMap((teacher) => {
        if (!teacher.email) return [];
        const dedupeHash = createHash("sha1")
          .update(`${teacher.id}:${studentId}:${NOTIFY_TYPE}:${dayBucket(now)}`)
          .digest("hex");
        return [
          enqueueJobWithCooldown({
            type: "send_email",
            dedupeKey: `wellbeing:${dedupeHash}`,
            cooldownHours: 12,
            payload: {
              to: teacher.email,
              subject: `VisionQuest: ${title}`,
              text:
                `${body}\n\n` +
                `${baseUrl ? `Open VisionQuest: ${baseUrl}\n\n` : ""}` +
                "This is an automated wellbeing alert. No student message text is included for privacy — " +
                "open the student's conversation in VisionQuest to see context.",
            },
          }),
        ];
      }),
    );
  } catch (err) {
    logger.error("Wellbeing: failed to notify staff", {
      studentId,
      reason,
      alert: "wellbeing_notify_failed",
      error: String(err),
    });
  }
}
