/**
 * Request-time crisis scan for student chat.
 *
 * Runs at the top of POST /api/chat/send, before provider resolution, rate
 * limits, and the direct-answer branches, so a crisis signal raises the staff
 * alert on every exit from the handler: a 503 when the AI is down, a 429, a
 * form or small-talk reply that never calls a model, or a stream that errors
 * mid-reply (VQ-R-001).
 *
 * This is the ONLY message-signal call site. handlePostResponse does not scan
 * again: recordWellbeingConcern's alert row is idempotent per day, but its
 * staff-notification cooldowns are read-then-write, so two scans in one
 * request would race them.
 *
 * Record cap. Because the scan sits in front of the hourly chat limiter, a
 * burst of K parallel matching requests would reach recordWellbeingConcern K
 * times and race those same cooldowns. The write is therefore gated by an
 * atomic per-student counter (rateLimit is one INSERT ... ON CONFLICT upsert
 * through prismaAdmin, so it works in student RLS context): at most
 * CRISIS_RECORD_CAP records per CRISIS_RECORD_WINDOW_MS. The first signal in
 * a window always records. The counter fails open: if it throws or reports
 * degraded, the concern is recorded anyway. Nothing here can block the
 * crisis path, and the counter is never consulted for a non-crisis turn.
 *
 * Never throws: the chat reply must not depend on the alert path. Failures
 * are logged with the student's one-way log key and the category only.
 * Message text never leaves the request (locked privacy decision).
 */
import {
  detectCrisisSignal,
  recordWellbeingConcern,
  type CrisisCategory,
} from "@/lib/sage/crisis-detection";
import { rateLimit } from "@/lib/rate-limit";
import { rateLimitsDisabled } from "@/lib/rate-limit-switch";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

/**
 * Wellbeing records per student per window. The daily alert row is idempotent
 * either way; the cap bounds the notification and email fan-out behind it.
 */
const CRISIS_RECORD_CAP = 3;
const CRISIS_RECORD_WINDOW_MS = 10 * 60_000;

/** True when this signal may be recorded. Fails open on any counter failure. */
async function recordAllowed(studentId: string): Promise<boolean> {
  if (rateLimitsDisabled()) return true;
  try {
    const result = await rateLimit(
      `crisis:${studentId}`,
      CRISIS_RECORD_CAP,
      CRISIS_RECORD_WINDOW_MS,
    );
    return result.success;
  } catch (err) {
    logger.warn("Crisis record limiter failed; recording anyway", {
      student: studentLogKey(studentId),
      error: String(err),
    });
    return true;
  }
}

export async function scanStudentMessageForCrisis({
  studentId,
  userMessage,
}: {
  studentId: string;
  userMessage: string;
}): Promise<void> {
  let category: CrisisCategory | null = null;
  try {
    const signal = detectCrisisSignal(userMessage);
    if (!signal.matched) return;
    category = signal.category;

    if (!(await recordAllowed(studentId))) {
      logger.info("Crisis record burst capped", {
        student: studentLogKey(studentId),
        category,
        cap: CRISIS_RECORD_CAP,
        windowMs: CRISIS_RECORD_WINDOW_MS,
      });
      return;
    }

    // conversationId is always null here. The only id available this early
    // is the client-supplied one, which is cuid-shaped but unverified and
    // would land in StudentAlert.sourceId; the alert keys on student and day.
    await recordWellbeingConcern({
      studentId,
      conversationId: null,
      reason: "message_signal",
      category,
    });
  } catch (err) {
    logger.error("Crisis scan failed", {
      student: studentLogKey(studentId),
      category,
      alert: "wellbeing_detection_failed",
      error: String(err),
    });
  }
}
