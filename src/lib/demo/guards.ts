import { forbidden, type Session } from "@/lib/api-error";
import { DEMO_CREDENTIALS_REFUSAL } from "./copy";

/**
 * Cohort demo mode: small checks on the session's demo marker.
 *
 * `Session.demoAccount` is set only for a demo row while the demo switch is on
 * (see `getSession` in src/lib/auth.ts), so these checks are false everywhere
 * when demo mode is off.
 */

/** True for the one shared demo instructor, false for every other session. */
export function isDemoInstructor(session: Pick<Session, "demoAccount">): boolean {
  return session.demoAccount === "instructor";
}

/**
 * Throws 403 for either kind of demo account. Use it on routes that change a
 * sign-in setting, so a visitor cannot lock the shared account out.
 */
export function assertNotDemoAccount(
  session: Pick<Session, "demoAccount">,
  message?: string,
): void {
  if (session.demoAccount !== undefined) {
    throw forbidden(message ?? DEMO_CREDENTIALS_REFUSAL);
  }
}
