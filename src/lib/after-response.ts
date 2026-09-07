import { after } from "next/server";

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
 * until it completes. It is bound with `AsyncLocalStorage.bind`, so the
 * caller's RLS context (`withRlsContext`) is still in place when the effect
 * runs — the deferred queries see the same actor the route did.
 *
 * `after()` throws when there is no request scope (unit tests calling a
 * route handler directly, scripts). In that case the effect runs at once,
 * un-awaited, so the caller's contract — "this returns without waiting" —
 * holds on both paths and tests can still observe the effect being invoked.
 *
 * The effect must never reject: wrap it in `afterWrite` (or catch inside)
 * so a failure is logged rather than surfacing as an unhandled rejection.
 */
export function deferAfterResponse(effect: () => Promise<void>): void {
  try {
    after(effect);
  } catch {
    void effect();
  }
}
