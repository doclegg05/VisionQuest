import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
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
  { category: "self_harm", pattern: /\b((hurt|harm|cut)(ting|t)?\s+myself|self[-\s]?harm(ing)?)\b/i },
  { category: "harm_others", pattern: /\b(want|going)\s+to\s+(hurt|kill)\s+(someone|him|her|them|people|everyone)\b/i },
  { category: "abuse", pattern: /\b(be(ing)?\s+abused|he\s+hits\s+me|she\s+hits\s+me|they\s+hit\s+me|hits?\s+me\s+at\s+home|hurt(s|ing)?\s+me\s+at\s+home|being\s+(hurt|hit)\s+at\s+home)\b/i },

  // --- Spanish (es) — P2-7. Same phrase-level, case-insensitive, word-boundary
  // style as the English set above; English entries are untouched and tested
  // first. Accented and unaccented spellings are both matched via explicit
  // alternations ("daño"/"dano", "mí"/"mi", "más"/"mas") because students often
  // type without accents; no Unicode-insensitive flags are used, so existing
  // behavior cannot shift. NOTE: JS \b is ASCII-only and fails AFTER a final
  // accented letter ("mí", "pegó"), so those entries end with a
  // (?![\wáéíóúüñ]) guard instead of \b. Sensitivity mirrors English — err
  // toward alerting: idioms like "quiero morir de risa" match, exactly as
  // "want to die" matches "I want to die laughing".
  // self_harm (es)
  { category: "self_harm", pattern: /\b(me\s+quiero\s+morir|(quiero|quisiera)\s+morir(me)?)\b/i },
  { category: "self_harm", pattern: /\b(matarme|me\s+quiero\s+matar)\b/i },
  { category: "self_harm", pattern: /\bquitarme\s+la\s+vida\b/i },
  // Stem match — suicidio, suicida(s), suicidarme, suicidarse, suicidé, ...
  { category: "self_harm", pattern: /\bsuicid/i },
  { category: "self_harm", pattern: /\b(acabar|terminar)\s+con\s+mi\s+vida\b/i },
  { category: "self_harm", pattern: /\bno\s+quiero\s+(vivir|seguir\s+viviendo)\b/i },
  { category: "self_harm", pattern: /\b(no\s+vale\s+la\s+pena\s+vivir|la\s+vida\s+no\s+vale\s+la\s+pena)\b/i },
  { category: "self_harm", pattern: /\b((hacerme|me\s+hago|me\s+hice|me\s+har(é|e)|me\s+quiero\s+hacer)\s+da(ñ|n)o|lastimarme|cortarme\s+las\s+venas)\b/i },
  { category: "self_harm", pattern: /\b(mejor\s+muert[oa]|quisiera\s+estar\s+muert[oa])\b/i },
  // Ambiguous like the English "can't go on" — included per err-toward-alerting.
  { category: "self_harm", pattern: /\b(ya\s+)?no\s+puedo\s+m(á|a)s\b/i },
  // harm_others (es) — a person object (attached clitic or personal "a") is
  // required, mirroring the English object list; that keeps "matar el tiempo"
  // ("kill time") from false-positive while catching "quiero matar a mi jefe".
  { category: "harm_others", pattern: /\bhacerles?\s+da(ñ|n)o\s+a\b/i },
  { category: "harm_others", pattern: /\b((quiero|quisiera|voy\s+a)\s+matar(l[oa]s?|te|les?|\s+a)|(l[oa]s?|te|les?)\s+(quiero|voy\s+a)\s+matar)\b/i },
  { category: "harm_others", pattern: /\b((quiero|voy\s+a)\s+lastimar(l[oa]s?|te|les?)?|lastimar\s+a\s+alguien)\b/i },
  // abuse (es) — Spanish is pro-drop ("me pega" = "[he] hits me"), so unlike
  // the English "he/she hits me" no subject pronoun is required: the
  // subjectless form IS the natural disclosure and requiring one would miss
  // real cases. "tengo miedo de mi ..." is bounded to partner nouns to keep
  // precision ("tengo miedo de mi examen" must not alert).
  { category: "abuse", pattern: /\bme\s+(peg|golpe|maltrat|amenaz)(a|an|aba|aban|aron|ó|o)(?![\wáéíóúüñ])/i },
  { category: "abuse", pattern: /\bme\s+est(á|a)n?\s+(pegando|golpeando|maltratando|amenazando|abusando)\b/i },
  { category: "abuse", pattern: /\babus(a|an|ó|o|aba|aban|aron|ando)\s+de\s+m[ií](?![\wáéíóúüñ])/i },
  { category: "abuse", pattern: /\b(tengo\s+miedo\s+de|le\s+tengo\s+miedo\s+a)\s+mi\s+(pareja|esposo|esposa|marido|mujer|novio|novia)\b/i },
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

interface StaffRecipient {
  id: string;
  email: string | null;
}

// Enrollment statuses under which a class instructor still "manages" the
// student. Mirrors NON_ARCHIVED_ENROLLMENT_STATUSES in src/lib/classroom.ts —
// kept local so this safety-critical module stays dependency-light. If the two
// ever drift, the failure mode is resolving fewer (possibly zero) instructors,
// which falls back to notifying ALL active teachers: the safe direction.
const MANAGED_ENROLLMENT_STATUSES = ["active", "inactive", "completed", "withdrawn"] as const;

/**
 * Resolve the unique, active instructor accounts assigned to the classes the
 * student is (non-archived) enrolled in. Returns [] when none resolve; any
 * thrown error is handled by the caller, which falls back to all active
 * teachers.
 */
async function findAssignedInstructors(studentId: string): Promise<StaffRecipient[]> {
  const enrollments = await prisma.studentClassEnrollment.findMany({
    where: {
      studentId,
      status: { in: [...MANAGED_ENROLLMENT_STATUSES] },
    },
    select: {
      class: {
        select: {
          instructors: {
            select: {
              instructor: { select: { id: true, email: true, isActive: true } },
            },
          },
        },
      },
    },
  });

  const activeInstructors = enrollments
    .flatMap((enrollment) => enrollment.class.instructors)
    .map((link) => link.instructor)
    .filter((instructor) => instructor.isActive);

  return [
    ...new Map(
      activeInstructors.map((instructor): [string, StaffRecipient] => [
        instructor.id,
        { id: instructor.id, email: instructor.email },
      ]),
    ).values(),
  ];
}

/**
 * Who gets actively notified about a wellbeing concern.
 *
 * SAFETY: the audience must NEVER be narrower than the pre-scoping behavior
 * (all active teachers). Assigned class instructors are preferred so the most
 * sensitive signal in the system isn't over-disclosed program-wide, but zero
 * resolved instructors OR any resolution failure falls back to every active
 * teacher — over-notifying is the safe failure mode.
 */
async function resolveWellbeingRecipients(studentId: string): Promise<StaffRecipient[]> {
  let assigned: StaffRecipient[] = [];
  try {
    assigned = await findAssignedInstructors(studentId);
  } catch (err) {
    logger.error("Wellbeing: instructor resolution failed; falling back to all active teachers", {
      studentId,
      alert: "wellbeing_instructor_resolution_failed",
      error: String(err),
    });
  }

  if (assigned.length > 0) return assigned;

  return prisma.student.findMany({
    where: { role: "teacher", isActive: true },
    select: { id: true, email: true },
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
      studentId,
      alert: "wellbeing_mood_lookup_failed",
      error: String(err),
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
      studentId,
      reason,
      alert: "wellbeing_alert_failed",
      error: String(err),
    });
  }

  // 2. Actively notify staff (in-app always; email best-effort). Prefer the
  //    student's assigned class instructors; if none resolve (unenrolled
  //    student, data gap, or a failed lookup) fall back to ALL active teachers.
  //    The audience is never narrower than the pre-scoping behavior — for a
  //    crisis signal, over-notifying is the safe failure mode.
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
        sendNotificationWithCooldown(recipient.id, { type: NOTIFY_TYPE, title, body }, 12),
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
      studentId,
      reason,
      alert: "wellbeing_notify_failed",
      error: String(err),
    });
  }
}
