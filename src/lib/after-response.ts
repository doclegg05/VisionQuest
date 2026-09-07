import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";
import { redactContactInfo } from "./log-redaction";
import { logger } from "./logger";

/**
 * Run a best-effort side effect AFTER the response has been sent.
 *
 * Why this exists (prod incident, 2026-09-07): `POST /api/forms/sign` and
 * the student path of `POST /api/orientation` both awaited
 * `syncStudentAlerts` — dozens of RLS-wrapped queries plus an interactive
 * transaction over every one of the student's alert rows — before answering.
 * The student saw a small "Submitting..." label for the ~45 seconds that
 * took, tapped Sign & Submit 13 more times, and every tap ran the same sync
 * again, all of them serialising on the same alert rows and starving the
 * 10-connection pool. The signature itself had saved in well under a
 * second. Alert bookkeeping is teacher-queue maintenance; the student's
 * response must never wait on it.
 *
 * `after()` is Next's primitive for exactly this: the callback runs once the
 * response has finished streaming, and the server keeps the process alive
 * until it completes.
 *
 * The effect is bound to the CURRENT async context here, with
 * `AsyncLocalStorage.bind`, before it is handed over. Next does the same
 * internally today, but the RLS actor (`withRlsContext`, read by the Prisma
 * extension on every query) is the one thing the deferred sync must not
 * lose, so this module does not rely on another library's private
 * behaviour for it. `after-response.test.ts` pins it by invoking the task
 * from outside the scope.
 *
 * `after()` throws when there is no request scope (unit tests calling a
 * route handler directly, scripts). In that case the effect runs at once,
 * un-awaited, so the caller's contract — "this returns without waiting" —
 * holds on both paths and tests can still observe the effect being invoked.
 *
 * Callers should wrap the effect in `afterWrite` so a failure is logged
 * with its surface and a correlation key. The catch below is the backstop
 * for an effect that rejects anyway: logged, never an unhandled rejection.
 */
export function deferAfterResponse(effect: () => Promise<void>): void {
  const guarded = AsyncLocalStorage.bind(() =>
    effect().catch((error: unknown) => {
      logger.error("Deferred effect rejected after the response was sent", {
        error: redactContactInfo(String(error)),
      });
    }),
  );
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
