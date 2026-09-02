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
 * Never throws: the chat reply must not depend on the alert path. Failures
 * are logged with the student's one-way log key and the category only.
 * Message text never leaves the request (locked privacy decision).
 */
import {
  detectCrisisSignal,
  recordWellbeingConcern,
  type CrisisCategory,
} from "@/lib/sage/crisis-detection";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

export async function scanStudentMessageForCrisis({
  studentId,
  conversationId,
  userMessage,
}: {
  studentId: string;
  /** The conversation id the client asked for; null when none exists yet. */
  conversationId: string | null;
  userMessage: string;
}): Promise<void> {
  let category: CrisisCategory | null = null;
  try {
    const signal = detectCrisisSignal(userMessage);
    if (!signal.matched) return;
    category = signal.category;
    await recordWellbeingConcern({
      studentId,
      conversationId,
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
