import { studentLogKey } from "./log-keys";
import { logger } from "./logger";

interface AfterWriteContext {
  /** The route or job the write belongs to, e.g. "forms/sign". */
  surface: string;
  /** The side effect being run, e.g. "syncStudentAlerts". */
  effect: string;
  /** The student the write belongs to. Logged only as a one-way key. */
  studentId: string;
  /** "error" when the gap needs follow-up (an audit row); "warn" otherwise. */
  level?: "warn" | "error";
}

/**
 * Run a best-effort side effect after a durable write has committed.
 *
 * A route that saves a row and then syncs alerts, writes an audit row, or
 * sends a notification must not report the save as failed when only the
 * follow-up threw: the row is already there, and the student would retry a
 * write that succeeded (review finding F26, the "Signature submission
 * failed." bug). The failure is logged with a correlation key instead.
 *
 * Only for effects the record stays consistent without. An effect the write
 * depends on belongs before the write, not here.
 */
export async function afterWrite(
  effect: () => Promise<unknown> | unknown,
  context: AfterWriteContext,
): Promise<void> {
  try {
    await effect();
  } catch (error) {
    const log = context.level === "error" ? logger.error : logger.warn;
    log("Side effect failed after a saved write", {
      surface: context.surface,
      effect: context.effect,
      student: studentLogKey(context.studentId),
      error: String(error),
    });
  }
}
