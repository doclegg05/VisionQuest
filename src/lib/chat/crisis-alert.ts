import {
  detectCrisisSignal,
  recordWellbeingConcern,
  type CrisisCategory,
} from "@/lib/sage/crisis-detection";
import { logger } from "@/lib/logger";

/**
 * Single implementation of the deterministic crisis scan → staff alert step.
 *
 * VQ-R-001: this used to live inline in handlePostResponse, which the chat
 * route only reaches AFTER a model stream completes successfully. A provider
 * 503, a mid-stream error, or a client disconnect therefore persisted the
 * student's message and raised no alert — even though post-response's own
 * header claimed a provider outage could never suppress it. The scan is pure,
 * synchronous and free, so it belongs before provider resolution.
 *
 * Callers are fire-and-forget: this never throws and never rejects. It returns
 * whether an alert was recorded so callers can log, not so they can branch on
 * student safety.
 *
 * Safe to call more than once per turn — recordWellbeingConcern upserts one
 * alert per student per day, so the early hook and the post-response call
 * collapse into a single alert row.
 */
export async function raiseCrisisAlertIfSignalled({
  userMessage,
  studentId,
  conversationId,
  isStaffChat = false,
  detect = detectCrisisSignal,
  record = recordWellbeingConcern,
}: {
  userMessage: string;
  studentId: string;
  conversationId: string | null;
  /** Staff turns are not scanned — a teacher describing a student is not the subject. */
  isStaffChat?: boolean;
  detect?: (text: string) => { matched: boolean; category: CrisisCategory | null };
  record?: (args: {
    studentId: string;
    conversationId: string | null;
    reason: "message_signal";
    category: CrisisCategory | null;
  }) => Promise<void>;
}): Promise<boolean> {
  if (isStaffChat) return false;

  try {
    const signal = detect(userMessage);
    if (!signal.matched) return false;

    // Category only — never the message text (locked privacy decision).
    await record({
      studentId,
      conversationId,
      reason: "message_signal",
      category: signal.category,
    });
    return true;
  } catch (err) {
    logger.error("Wellbeing detection failed", {
      conversationId,
      alert: "wellbeing_detection_failed",
      error: String(err),
    });
    return false;
  }
}
